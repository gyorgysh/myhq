/**
 * Resolve theme CSS custom properties to concrete color strings at runtime.
 *
 * Some consumers (notably xterm.js) need real hex/rgb colors, not `var(--…)`
 * references or empty strings. This reads the *computed* value of a CSS var off
 * `<html>` (which resolves nested `var()` chains), falling back to a safe
 * concrete color when the token is missing. Centralizing the fallbacks here
 * keeps the hardcoded hexes out of feature components.
 */

/** Safe concrete fallbacks for the theme tokens the terminal needs, split by
 *  light vs dark so foreground/background never mismatch (which would render
 *  text invisible). Values mirror the light/dark token definitions in
 *  index.css. */
const XTERM_FALLBACKS = {
  light: {
    page: "#f5f9fb",
    fg: "#18181b",
    accent: "#087f9c",
    black: "#3a3a42",
    brightBlack: "#71717a",
    white: "#3f3f46",
    brightWhite: "#18181b",
  },
  dark: {
    page: "#08131a",
    fg: "#e6f0f4",
    accent: "#3ec7e6",
    black: "#1a1a1e",
    brightBlack: "#3a3a42",
    white: "#c8c8d0",
    brightWhite: "#e2e2e6",
  },
} as const;

/** True when the active theme is the light one. `data-theme` on <html> is the
 *  source of truth; unset (or any dark-based peer) counts as dark. */
export function isLightTheme(): boolean {
  return document.documentElement.getAttribute("data-theme") === "light";
}

/** An xterm.js `ITheme`-compatible color set derived from the current CSS
 *  theme, with concrete fallbacks so no field is ever an empty string. */
export interface XtermThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  brightBlack: string;
  white: string;
  brightWhite: string;
}

/** Build the xterm color theme from the live CSS variables, resolving each to a
 *  concrete color and falling back per light/dark so text stays readable. */
export function resolveXtermTheme(): XtermThemeColors {
  const style = getComputedStyle(document.documentElement);
  const light = isLightTheme();
  const fb = light ? XTERM_FALLBACKS.light : XTERM_FALLBACKS.dark;
  const cssVar = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  const bg = cssVar("--color-page", fb.page);
  const fg = cssVar("--color-fg", fb.fg);
  const accent = cssVar("--color-accent", fb.accent);

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: accent + "44",
    black: fb.black,
    brightBlack: fb.brightBlack,
    white: fb.white,
    brightWhite: fb.brightWhite,
  };
}
