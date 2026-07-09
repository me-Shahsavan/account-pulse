import { NylasClient } from "./client.js";

// The "book of business" view: aggregate recent threads by counterpart to
// rank relationships by who-owes-whom and staleness. Built entirely from
// the threads list endpoint — no extra Nylas calls per contact.

export interface RelationshipRow {
  email: string;
  name?: string;
  threads: number;
  lastTouchIso: string;
  staleDays: number;
  // "you"  -> they wrote last, a reply is owed by the account owner
  // "them" -> the owner wrote last, waiting on the contact
  owesReply: "you" | "them";
}

interface RawThread {
  id: string;
  participants?: { email: string; name?: string }[];
  latest_message_received_date?: number;
  latest_message_sent_date?: number;
}

// Skip obvious machine senders so the dashboard shows people, not robots.
const NOISE = /no-?reply|notification|mailer|newsletter|donotreply|updates@|noreply/i;

export async function listRelationships(
  client: NylasClient,
  grantId: string,
  ownerEmail: string,
  daysBack = 30,
  maxThreads = 200,
): Promise<RelationshipRow[]> {
  const after = Math.floor(Date.now() / 1000) - daysBack * 24 * 60 * 60;
  const threads = await client.listAll<RawThread>(
    `/v3/grants/${grantId}/threads`,
    { latest_message_after: after, limit: 50 },
    maxThreads,
  );

  const owner = ownerEmail.toLowerCase();
  const byContact = new Map<
    string,
    { name?: string; threads: number; lastReceived: number; lastSent: number }
  >();

  for (const t of threads) {
    const counterparts = (t.participants ?? []).filter(
      (p) => p.email && p.email.toLowerCase() !== owner && !NOISE.test(p.email),
    );
    for (const p of counterparts) {
      const key = p.email.toLowerCase();
      const entry = byContact.get(key) ?? { name: p.name, threads: 0, lastReceived: 0, lastSent: 0 };
      entry.threads += 1;
      entry.name ||= p.name;
      entry.lastReceived = Math.max(entry.lastReceived, t.latest_message_received_date ?? 0);
      entry.lastSent = Math.max(entry.lastSent, t.latest_message_sent_date ?? 0);
      byContact.set(key, entry);
    }
  }

  const nowSec = Date.now() / 1000;
  const rows: RelationshipRow[] = [...byContact.entries()].map(([email, e]) => {
    const lastTouch = Math.max(e.lastReceived, e.lastSent);
    return {
      email,
      name: e.name,
      threads: e.threads,
      lastTouchIso: new Date(lastTouch * 1000).toISOString(),
      staleDays: Math.floor((nowSec - lastTouch) / 86400),
      owesReply: e.lastReceived >= e.lastSent ? "you" : "them",
    };
  });

  // Reply-owed first, then freshest conversations.
  return rows.sort((a, b) => {
    if (a.owesReply !== b.owesReply) return a.owesReply === "you" ? -1 : 1;
    return a.staleDays - b.staleDays;
  });
}
