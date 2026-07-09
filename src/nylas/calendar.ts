import { NylasClient } from "./client.js";

// Calendar read primitives: list calendars, and find open slots via the
// v3 Availability endpoint (POST /v3/calendars/availability). Availability
// is computed by Nylas from real calendar data for the given participants.

export interface CalendarInfo {
  id: string;
  name: string;
  isPrimary: boolean;
  readOnly: boolean;
}

export interface OpenSlot {
  startIso: string;
  endIso: string;
  startLocal: string; // human-readable in the user's timezone
}

export async function listCalendars(
  client: NylasClient,
  grantId: string,
): Promise<CalendarInfo[]> {
  const raw = await client.listAll<{
    id: string;
    name?: string;
    is_primary?: boolean;
    read_only?: boolean;
  }>(`/v3/grants/${grantId}/calendars`, { limit: 50 }, 50);

  return raw.map((c) => ({
    id: c.id,
    name: c.name ?? "(unnamed)",
    isPrimary: Boolean(c.is_primary),
    readOnly: Boolean(c.read_only),
  }));
}

function formatLocal(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Ask Nylas for open slots over the next `daysAhead` days, then keep only
// business-hours slots (Mon-Fri, 09:00-17:00 in the user's timezone).
export async function getAvailability(
  client: NylasClient,
  ownerEmail: string,
  options: {
    daysAhead?: number;
    durationMinutes?: number;
    timezone: string;
    maxSlots?: number;
  },
): Promise<OpenSlot[]> {
  const daysAhead = options.daysAhead ?? 7;
  const durationMinutes = options.durationMinutes ?? 30;
  const now = Math.floor(Date.now() / 1000);

  const res = await client.request<{
    time_slots?: { start_time: number; end_time: number }[];
  }>("/v3/calendars/availability", {
    method: "POST",
    body: {
      participants: [{ email: ownerEmail }],
      start_time: now,
      end_time: now + daysAhead * 24 * 60 * 60,
      duration_minutes: durationMinutes,
      interval_minutes: 30,
    },
  });

  const slots = res.data?.time_slots ?? [];
  const inBusinessHours = (epoch: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: options.timezone,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(epoch * 1000));
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    return !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour < 17;
  };

  return slots
    .filter((s) => inBusinessHours(s.start_time))
    .slice(0, options.maxSlots ?? 12)
    .map((s) => {
      const startIso = new Date(s.start_time * 1000).toISOString();
      return {
        startIso,
        endIso: new Date(s.end_time * 1000).toISOString(),
        startLocal: `${formatLocal(startIso, options.timezone)} (${options.timezone})`,
      };
    });
}
