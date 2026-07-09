import { NylasClient } from "../nylas/client.js";
import { toolDefinitions, executeTool, ToolContext } from "./tools.js";
import { SYSTEM_PROMPT, PulseResult } from "./pulse.js";

// Alternative LLM transport: the same Claude Sonnet 4.6 agent, but through
// OpenRouter's OpenAI-compatible /chat/completions endpoint. Same tools,
// same system prompt, same "no send tool" boundary — only the wire format
// differs (tool_calls instead of Anthropic content blocks).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

// Map Anthropic-style tool definitions to OpenAI function-tool format.
const openAiTools = toolDefinitions.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

export async function runPulseOpenRouter(options: {
  openrouterApiKey: string;
  model?: string;
  nylas: NylasClient;
  grantId: string;
  ownerEmail: string;
  contactEmail: string;
  timezone: string;
  daysBack?: number;
  onProgress?: (note: string) => void;
}): Promise<PulseResult> {
  const ctx: ToolContext = {
    nylas: options.nylas,
    grantId: options.grantId,
    ownerEmail: options.ownerEmail,
    contactEmail: options.contactEmail,
    timezone: options.timezone,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Give me a pulse on my relationship with ${options.contactEmail}. ` +
        `Look back ${options.daysBack ?? 90} days. My email is ${options.ownerEmail}; ` +
        `my timezone is ${options.timezone}.`,
    },
  ];

  let turns = 0;
  const MAX_TURNS = 12;

  while (turns < MAX_TURNS) {
    turns += 1;
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.openrouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model ?? DEFAULT_MODEL,
        max_tokens: 4096,
        tools: openAiTools,
        messages,
      }),
    });

    const json: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `OpenRouter ${response.status}: ${json?.error?.message ?? JSON.stringify(json)}`,
      );
    }

    const message = json.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter returned no message.");

    if (message.tool_calls?.length) {
      messages.push(message);
      for (const call of message.tool_calls) {
        options.onProgress?.(`tool: ${call.function.name}`);
        let result: string;
        try {
          const input = JSON.parse(call.function.arguments || "{}");
          result = await executeTool(ctx, call.function.name, input);
        } catch (err) {
          result = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      continue;
    }

    return { report: message.content ?? "", draft: ctx.draft, turns };
  }

  throw new Error(`Agent did not finish within ${MAX_TURNS} turns.`);
}
