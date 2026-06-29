import { config } from "../config.js";
import { loadJson, saveJson } from "./jsonStore.js";
import { audit } from "./audit.js";

const FILE = "branding.json";

/**
 * White-label branding overrides for the panel + product chrome. This is a
 * **licensed** feature: the full configuration surface exists and persists, but
 * the overrides are only *applied* (folded into `/api/me`, so the panel actually
 * renders them) when `unlocked` is true. There is deliberately **no panel route**
 * that flips `unlocked` — it is reserved for a future license/entitlement layer.
 * Self-hosters can still set it directly via `BRANDING_UNLOCKED=true` in `.env`
 * (free for personal use), which is the only way to turn it on today.
 *
 * Until unlocked, `effectiveBranding()` returns the env-default names
 * (`ATLAS_NAME`/`BRAND_NAME`) and no custom assets, exactly as before, so the
 * stored draft has no effect on what users see.
 */
export interface Branding {
  /** Product name (login/setup header, page title prefix). "" = BRAND_NAME env. */
  brandName?: string;
  /** Main agent display name. "" = ATLAS_NAME env. */
  agentName?: string;
  /** Browser tab / panel title. "" = falls back to brandName. */
  panelTitle?: string;
  /** Sidebar logo: a data: URL or absolute https URL to a small image. */
  logoUrl?: string;
  /** Favicon: a data: URL or absolute https URL. */
  faviconUrl?: string;
  /** Footer line appended to outbound emails / notifications. */
  emailFooter?: string;
  /** Accent colour override (CSS colour, e.g. #6d28d9). "" = theme default. */
  accentColor?: string;
}

interface BrandingFile {
  version: 1;
  branding: Branding;
}

const EMPTY: Branding = {};

function load(): Branding {
  const f = loadJson<BrandingFile>(FILE, { version: 1, branding: EMPTY });
  return f.branding ?? EMPTY;
}

/** Whether white-label overrides may be applied. Gated behind the license env. */
export function brandingUnlocked(): boolean {
  return config.BRANDING_UNLOCKED === true;
}

/** The saved branding draft (always returned, regardless of unlock state). */
export function getBranding(): Branding {
  return load();
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;
/** Only http(s) and inline data: image URLs are allowed (no javascript: etc.). */
const SAFE_URL = /^(https:\/\/|data:image\/)/i;

function sanitizeUrl(v: string | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return "";
  return SAFE_URL.test(s) ? s.slice(0, 256_000) : undefined;
}

function sanitizeText(v: string | undefined, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.trim().slice(0, max);
}

/** Persist a branding draft. Unknown/invalid fields are dropped, not rejected. */
export function setBranding(patch: Partial<Branding>): Branding {
  const cur = load();
  const next: Branding = { ...cur };
  if (patch.brandName !== undefined) next.brandName = sanitizeText(patch.brandName, 60);
  if (patch.agentName !== undefined) next.agentName = sanitizeText(patch.agentName, 60);
  if (patch.panelTitle !== undefined) next.panelTitle = sanitizeText(patch.panelTitle, 60);
  if (patch.emailFooter !== undefined) next.emailFooter = sanitizeText(patch.emailFooter, 280);
  if (patch.logoUrl !== undefined) {
    const u = sanitizeUrl(patch.logoUrl);
    if (u !== undefined) next.logoUrl = u;
  }
  if (patch.faviconUrl !== undefined) {
    const u = sanitizeUrl(patch.faviconUrl);
    if (u !== undefined) next.faviconUrl = u;
  }
  if (patch.accentColor !== undefined) {
    const c = (patch.accentColor ?? "").trim();
    next.accentColor = c === "" || HEX.test(c) ? c : cur.accentColor;
  }
  saveJson<BrandingFile>(FILE, { version: 1, branding: next });
  audit("branding.update", { unlocked: brandingUnlocked() });
  return next;
}

/**
 * The branding the panel should actually render. When locked, this collapses to
 * the env-default names and no custom assets, so a saved draft never leaks into
 * the live UI until the feature is unlocked.
 */
export function effectiveBranding(): Required<Pick<Branding, "brandName" | "agentName">> & Branding {
  const draft = load();
  if (!brandingUnlocked()) {
    return { brandName: config.BRAND_NAME, agentName: config.ATLAS_NAME };
  }
  return {
    brandName: draft.brandName || config.BRAND_NAME,
    agentName: draft.agentName || config.ATLAS_NAME,
    panelTitle: draft.panelTitle || undefined,
    logoUrl: draft.logoUrl || undefined,
    faviconUrl: draft.faviconUrl || undefined,
    emailFooter: draft.emailFooter || undefined,
    accentColor: draft.accentColor || undefined,
  };
}
