import { NylasClient } from "./client.js";

// Read primitives over the Nylas v3 Email API, trimmed to what the agent
// actually needs. Bodies are stripped and truncated so tool results stay
// small — the agent can always fetch a specific thread for more.

export interface ThreadSummary {
  id: string;
  subject: string;
  latestMessageAt: string; // ISO date
  participants: string[];
  snippet: string;
  unread: boolean;
}

export interface MessageDetail {
  id: string;
  threadId?: string;
  subject: string;
  from: string[];
  to: string[];
  date: string; // ISO date
  direction: "sent" | "received";
  body: string;
}

interface RawThread {
  id: string;
  subject?: string;
  latest_message_received_date?: number;
  latest_message_sent_date?: number;
  participants?: { email: string; name?: string }[];
  snippet?: string;
  unread?: boolean;
}

interface RawMessage {
  id: string;
  thread_id?: string;
  subject?: string;
  from?: { email: string; name?: string }[];
  to?: { email: string; name?: string }[];
  date?: number;
  body?: string;
  snippet?: string;
  folders?: string[];
}

function toIso(epochSeconds?: number): string {
  return epochSeconds ? new Date(epochSeconds * 1000).toISOString() : "";
}

export function stripHtml(html: string, maxLength = 2000): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

// List threads exchanged with a contact within the last `daysBack` days.
// Uses the any_email filter (matches from/to/cc/bcc) and follows
// page_token/next_cursor pagination up to maxItems.
export async function searchThreads(
  client: NylasClient,
  grantId: string,
  contactEmail: string,
  daysBack = 90,
  maxItems = 100,
): Promise<ThreadSummary[]> {
  const after = Math.floor(Date.now() / 1000) - daysBack * 24 * 60 * 60;
  const raw = await client.listAll<RawThread>(
    `/v3/grants/${grantId}/threads`,
    {
      any_email: contactEmail,
      latest_message_after: after,
      limit: 50,
    },
    maxItems,
  );

  return raw.map((t) => ({
    id: t.id,
    subject: t.subject ?? "(no subject)",
    latestMessageAt: toIso(t.latest_message_received_date ?? t.latest_message_sent_date),
    participants: (t.participants ?? []).map((p) => p.email),
    snippet: t.snippet ?? "",
    unread: Boolean(t.unread),
  }));
}

// Fetch the messages of one thread with (truncated) bodies, ordered oldest
// first, with direction relative to the account owner.
export async function getThreadMessages(
  client: NylasClient,
  grantId: string,
  threadId: string,
  ownerEmail: string,
  maxItems = 25,
): Promise<MessageDetail[]> {
  const raw = await client.listAll<RawMessage>(
    `/v3/grants/${grantId}/messages`,
    { thread_id: threadId, limit: 50 },
    maxItems,
  );

  return raw
    .map((m) => {
      const from = (m.from ?? []).map((p) => p.email);
      return {
        id: m.id,
        threadId: m.thread_id,
        subject: m.subject ?? "(no subject)",
        from,
        to: (m.to ?? []).map((p) => p.email),
        date: toIso(m.date),
        direction: (from.some((e) => e.toLowerCase() === ownerEmail.toLowerCase())
          ? "sent"
          : "received") as "sent" | "received",
        body: stripHtml(m.body ?? m.snippet ?? ""),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
