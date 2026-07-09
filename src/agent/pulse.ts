import Anthropic from "@anthropic-ai/sdk";
import { NylasClient } from "../nylas/client.js";
import { toolDefinitions, executeTool, ToolContext, DraftProposal } from "./tools.js";

// Manual tool-use loop (instead of the SDK tool runner) so the boundary is
// explicit: the agent can only READ via Nylas and record a draft. The send
// step lives outside this file entirely.

export const SYSTEM_PROMPT = `You are Account Pulse, an assistant that assesses the health of a working relationship with one email contact, using ONLY data fetched through your tools.

Rules:
- Ground every claim in fetched thread data. Quote dates and facts from the actual messages. If the data is thin (few or no threads), say so plainly instead of inventing detail.
- Use search_threads first, then get_thread on the 1-3 most relevant threads, then get_availability. ALWAYS finish by calling draft_followup exactly once - even when no threads were found (then draft a brief first-touch email and note the missing history in the summary).
- Propose meeting slots by copying startLocal values EXACTLY as returned by get_availability. Never round, shift, or invent times.
- The draft email must be short, plain, and professional. No em-dashes. No marketing tone. Reference something concrete from the real correspondence when it exists.
- You cannot send email. A human reviews your draft and decides.

After your tools are done, produce your final answer in exactly this structure:

SUMMARY
<one short paragraph on the state of the relationship>

LAST TOUCH
<date and one line on the most recent exchange, and who spoke last>

OPEN ITEMS
- <open action items / unanswered questions, grounded in the threads; or "None found">

PROPOSED SLOTS
- <2-3 real open slots in the owner's timezone>

DRAFT
Subject: <draft subject>
<draft body>`;

export interface PulseResult {
  report: string;
  draft?: DraftProposal;
  slots?: import("../nylas/calendar.js").OpenSlot[];
  turns: number;
}

export async function runPulse(options: {
  anthropicApiKey: string;
  nylas: NylasClient;
  grantId: string;
  ownerEmail: string;
  contactEmail: string;
  timezone: string;
  daysBack?: number;
  onProgress?: (note: string) => void;
}): Promise<PulseResult> {
  const anthropic = new Anthropic({ apiKey: options.anthropicApiKey });
  const ctx: ToolContext = {
    nylas: options.nylas,
    grantId: options.grantId,
    ownerEmail: options.ownerEmail,
    contactEmail: options.contactEmail,
    timezone: options.timezone,
  };

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Give me a pulse on my relationship with ${options.contactEmail}. ` +
        `Look back ${options.daysBack ?? 90} days. My email is ${options.ownerEmail}; ` +
        `my timezone is ${options.timezone}.`,
    },
  ];

  let turns = 0;
  const MAX_TURNS = 12; // hard stop against runaway loops

  while (turns < MAX_TURNS) {
    turns += 1;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages,
    });

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        options.onProgress?.(`tool: ${block.name}`);
        let result: string;
        let isError = false;
        try {
          result = await executeTool(ctx, block.name, block.input);
        } catch (err) {
          isError = true;
          result = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const report = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { report, draft: ctx.draft, slots: ctx.slots, turns };
  }

  throw new Error(`Agent did not finish within ${MAX_TURNS} turns.`);
}
