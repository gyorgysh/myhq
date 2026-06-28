import { listConnectors } from "./connectors.js";
import { resolveSecret } from "./vault.js";
import { log } from "../logger.js";

/**
 * Calendar-aware heartbeat support. Fetches upcoming events from the live
 * Google Calendar / Apple Calendar connectors (read-only, the same HTTP/CalDAV
 * the connector MCP servers use) and turns them into proactive signals: an
 * upcoming-event heads-up inside a lookahead window, and overlap/conflict
 * warnings. Best-effort: a disabled or unconfigured connector is silently
 * skipped, and any fetch error is logged and swallowed so heartbeat never
 * breaks because a calendar was unreachable.
 */

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const ICLOUD_CALDAV_BASE = "https://caldav.icloud.com";

/** A normalized calendar event the signal builder works with. */
export interface CalEvent {
  summary: string;
  start: Date;
  end: Date;
  source: "google" | "apple";
}

/** Resolve a connector's live credential, or undefined if not usable. */
function credentialFor(id: string): string | undefined {
  const c = listConnectors().find((x) => x.id === id);
  if (!c || !c.enabled || !c.secretId) return undefined;
  const token = resolveSecret(c.secretId);
  return token || undefined;
}

/** True if either calendar connector is live (enabled + credentialled). */
export function anyCalendarConnected(): boolean {
  return !!credentialFor("gcal") || !!credentialFor("apple-calendar");
}

function parseGoogleDate(d?: { dateTime?: string; date?: string }): Date | undefined {
  if (!d) return undefined;
  if (d.dateTime) return new Date(d.dateTime);
  if (d.date) return new Date(`${d.date}T00:00:00`);
  return undefined;
}

/** Fetch the next events from Google Calendar within [now, now+windowMs]. */
async function fetchGoogle(windowMs: number): Promise<CalEvent[]> {
  const token = credentialFor("gcal");
  if (!token) return [];
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + windowMs).toISOString(),
  });
  const res = await fetch(`${GCAL_BASE}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    log.warn("Calendar signal: Google fetch failed", { status: res.status });
    return [];
  }
  const data = (await res.json()) as {
    items?: Array<{
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };
  const out: CalEvent[] = [];
  for (const it of data.items ?? []) {
    const start = parseGoogleDate(it.start);
    const end = parseGoogleDate(it.end) ?? (start ? new Date(start.getTime() + 3_600_000) : undefined);
    if (!start || !end) continue;
    out.push({ summary: it.summary || "(no title)", start, end, source: "google" });
  }
  return out;
}

// --- Apple Calendar (CalDAV) ----------------------------------------------

function basicAuthHeader(credential: string): string {
  const [username, ...rest] = credential.split(":");
  const password = rest.join(":");
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** Parse a CalDAV datetime (YYYYMMDD or YYYYMMDDTHHmmss[Z]) to a Date. */
function parseCalDavDate(d: string): Date | undefined {
  if (!d) return undefined;
  if (/^\d{8}$/.test(d)) {
    return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00`);
  }
  const m = d.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}`;
  return new Date(iso);
}

function caldavFmt(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

/** Discover the user's calendar home + calendar hrefs on iCloud. */
async function discoverAppleCalendars(credential: string): Promise<string[]> {
  const auth = basicAuthHeader(credential);
  const headers = { Authorization: auth, "Content-Type": "application/xml; charset=utf-8" };
  const principalRes = await fetch(`${ICLOUD_CALDAV_BASE}/`, {
    method: "PROPFIND",
    headers: { ...headers, Depth: "0" },
    body: `<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
  });
  const principalText = await principalRes.text();
  const principalHref =
    principalText.match(/current-user-principal[^>]*>[\s\S]*?<[^>]*href[^>]*>([^<]+)</i)?.[1]?.trim();
  if (!principalHref) return [];
  const homeRes = await fetch(
    principalHref.startsWith("http") ? principalHref : `${ICLOUD_CALDAV_BASE}${principalHref}`,
    {
      method: "PROPFIND",
      headers: { ...headers, Depth: "0" },
      body: `<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:" xmlns:cs="urn:ietf:params:xml:ns:caldav"><d:prop><cs:calendar-home-set/></d:prop></d:propfind>`,
    },
  );
  const homeText = await homeRes.text();
  const homeHref = homeText.match(/calendar-home-set[^>]*>[\s\S]*?<[^>]*href[^>]*>([^<]+)</i)?.[1]?.trim();
  if (!homeHref) return [];
  const listRes = await fetch(homeHref.startsWith("http") ? homeHref : `${ICLOUD_CALDAV_BASE}${homeHref}`, {
    method: "PROPFIND",
    headers: { ...headers, Depth: "1" },
    body: `<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`,
  });
  const listText = await listRes.text();
  const hrefs: string[] = [];
  const responseRe = /<[^>]*response[^>]*>([\s\S]*?)<\/[^>]*response>/gi;
  let r: RegExpExecArray | null;
  while ((r = responseRe.exec(listText)) !== null) {
    const block = r[1];
    if (!/calendar/i.test(block) || !/resourcetype/i.test(block)) continue;
    const href = block.match(/<[^>]*href[^>]*>([^<]+)</i)?.[1]?.trim();
    if (href && /\/calendars\/.+\//.test(href)) hrefs.push(href);
  }
  return hrefs;
}

/** Fetch Apple Calendar events in [now, now+windowMs] across all calendars. */
async function fetchApple(windowMs: number): Promise<CalEvent[]> {
  const credential = credentialFor("apple-calendar");
  if (!credential) return [];
  let hrefs: string[] = [];
  try {
    hrefs = await discoverAppleCalendars(credential);
  } catch (err) {
    log.warn("Calendar signal: Apple discovery failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  if (hrefs.length === 0) return [];
  const auth = basicAuthHeader(credential);
  const start = new Date();
  const end = new Date(Date.now() + windowMs);
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${caldavFmt(start)}" end="${caldavFmt(end)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
  const out: CalEvent[] = [];
  for (const href of hrefs.slice(0, 8)) {
    try {
      const url = href.startsWith("http") ? href : `${ICLOUD_CALDAV_BASE}${href}`;
      const res = await fetch(url, {
        method: "REPORT",
        headers: { Authorization: auth, "Content-Type": "application/xml; charset=utf-8", Depth: "1" },
        body,
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const calDataRe = /<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi;
      let m: RegExpExecArray | null;
      while ((m = calDataRe.exec(xml)) !== null) {
        const block = m[1];
        const get = (key: string) =>
          block.match(new RegExp(`${key}[^:]*:([^\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
        const s = parseCalDavDate(get("DTSTART"));
        const e = parseCalDavDate(get("DTEND")) ?? (s ? new Date(s.getTime() + 3_600_000) : undefined);
        if (!s || !e) continue;
        out.push({ summary: get("SUMMARY") || "(no title)", start: s, end: e, source: "apple" });
      }
    } catch {
      // Skip a calendar that errored; others may still work.
    }
  }
  return out;
}

/** Fetch and merge upcoming events from every live calendar connector. */
export async function fetchUpcomingEvents(windowMs: number): Promise<CalEvent[]> {
  const [g, a] = await Promise.all([
    fetchGoogle(windowMs).catch(() => [] as CalEvent[]),
    fetchApple(windowMs).catch(() => [] as CalEvent[]),
  ]);
  return [...g, ...a].sort((x, y) => x.start.getTime() - y.start.getTime());
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtUntil(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/** A heartbeat-style signal (key for dedupe + human text). */
export interface CalendarSignal {
  key: string;
  text: string;
}

/**
 * Build proactive calendar signals from upcoming events:
 *  - an imminent-event heads-up for anything starting within `leadMs`
 *  - a conflict warning for any pair of overlapping events in the window.
 * Returns [] when no calendar is connected.
 */
export async function collectCalendarSignals(opts: {
  /** How far ahead to scan for events. */
  windowMs: number;
  /** Flag events starting within this lead time as "imminent". */
  leadMs: number;
}): Promise<CalendarSignal[]> {
  if (!anyCalendarConnected()) return [];
  let events: CalEvent[];
  try {
    events = await fetchUpcomingEvents(opts.windowMs);
  } catch (err) {
    log.warn("Calendar signal collection failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  const now = Date.now();
  const out: CalendarSignal[] = [];

  // Imminent events: starting soon.
  for (const ev of events) {
    const until = ev.start.getTime() - now;
    if (until >= 0 && until <= opts.leadMs) {
      out.push({
        key: `cal:soon:${ev.start.getTime()}:${ev.summary}`,
        text: `Upcoming: "${ev.summary}" at ${fmtTime(ev.start)} (${fmtUntil(until)})`,
      });
    }
  }

  // Conflicts: overlapping pairs.
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (b.start.getTime() >= a.end.getTime()) break; // sorted: no later event can overlap a
      out.push({
        key: `cal:conflict:${a.start.getTime()}:${b.start.getTime()}`,
        text: `Conflict: "${a.summary}" (${fmtTime(a.start)}) overlaps "${b.summary}" (${fmtTime(b.start)})`,
      });
    }
  }
  return out;
}
