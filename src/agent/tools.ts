import Anthropic from "@anthropic-ai/sdk";
import { NylasClient } from "../nylas/client.js";
import { searchThreads, getThreadMessages } from "../nylas/email.js";
import { getAvailability, OpenSlot } from "../nylas/calendar.js";

// The agent's tool surface, kept deliberately small:
//   search_threads / get_thread  -> Nylas Email API (read)
//   get_availability             -> Nylas Calendar availability (read)
//   draft_followup               -> pure LLM; records the proposed draft
// There is intentionally NO send tool. Sending happens in app code after
// explicit human confirmation.

export interface DraftProposal {
  to: string;
  subject: string;
  body: string;
  summary: string;
  actionItems: string[];
}

export interface ToolContext {
  nylas: NylasClient;
  grantId: string;
  ownerEmail: string;
  contactEmail: string;
  timezone: string;
  // Filled in when the agent calls draft_followup.
  draft?: DraftProposal;
  // Last availability result, kept so the UI can render real slots.
  slots?: OpenSlot[];
}

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "search_threads",
    description:
      "List email threads exchanged with the contact within the last N days. " +
      "Returns compact summaries (id, subject, latest message date, participants, snippet). " +
      "Call this first to see the shape of the relationship.",
    input_schema: {
      type: "object",
      properties: {
        contact_email: { type: "string", description: "The contact's email address" },
        days_back: {
          type: "integer",
          description: "How many days of history to search (default 90)",
        },
      },
      required: ["contact_email"],
    },
  },
  {
    name: "get_thread",
    description:
      "Fetch the full messages of one thread (truncated bodies, oldest first, " +
      "with direction sent/received). Use on the few threads that matter most.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Thread id from search_threads" },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "get_availability",
    description:
      "Get the account owner's real open meeting slots for the next N days " +
      "(business hours, owner's timezone), computed from their calendar.",
    input_schema: {
      type: "object",
      properties: {
        days_ahead: {
          type: "integer",
          description: "How many days ahead to look (default 7)",
        },
        duration_minutes: {
          type: "integer",
          description: "Meeting length in minutes (default 30)",
        },
      },
    },
  },
  {
    name: "draft_followup",
    description:
      "Record your proposed follow-up email. This does NOT send anything - " +
      "a human reviews and explicitly confirms before any send happens. " +
      "Call exactly once, after you have grounded your summary in real thread data.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-paragraph relationship summary" },
        action_items: {
          type: "array",
          items: { type: "string" },
          description: "Open action items / unanswered questions",
        },
        subject: { type: "string", description: "Draft email subject" },
        body: { type: "string", description: "Draft email body (plain text)" },
      },
      required: ["summary", "action_items", "subject", "body"],
    },
  },
];

export async function executeTool(
  ctx: ToolContext,
  name: string,
  input: any,
): Promise<string> {
  switch (name) {
    case "search_threads": {
      const threads = await searchThreads(
        ctx.nylas,
        ctx.grantId,
        String(input.contact_email ?? ctx.contactEmail),
        input.days_back ? Number(input.days_back) : 90,
      );
      return JSON.stringify({ count: threads.length, threads });
    }
    case "get_thread": {
      const messages = await getThreadMessages(
        ctx.nylas,
        ctx.grantId,
        String(input.thread_id),
        ctx.ownerEmail,
      );
      return JSON.stringify({ count: messages.length, messages });
    }
    case "get_availability": {
      const slots = await getAvailability(ctx.nylas, ctx.ownerEmail, {
        daysAhead: input.days_ahead ? Number(input.days_ahead) : 7,
        durationMinutes: input.duration_minutes ? Number(input.duration_minutes) : 30,
        timezone: ctx.timezone,
      });
      ctx.slots = slots;
      return JSON.stringify({ count: slots.length, slots });
    }
    case "draft_followup": {
      ctx.draft = {
        to: ctx.contactEmail,
        subject: String(input.subject),
        body: String(input.body),
        summary: String(input.summary),
        actionItems: Array.isArray(input.action_items)
          ? input.action_items.map(String)
          : [],
      };
      return "Draft recorded. It will be shown to the user for review; it has NOT been sent.";
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
