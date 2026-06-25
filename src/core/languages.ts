/** Available agent response languages. BCP 47 code → display name. */
export const AGENT_LANGUAGES: Record<string, string> = {
  en: "English",
  hu: "Hungarian",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  ja: "Japanese",
  "zh-CN": "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
  ko: "Korean",
  ar: "Arabic",
  tr: "Turkish",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  ro: "Romanian",
  cs: "Czech",
  sk: "Slovak",
  hr: "Croatian",
  uk: "Ukrainian",
  el: "Greek",
  he: "Hebrew",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
};

/** Resolve a language code to its display name; falls back to code itself. */
export function languageName(code: string): string {
  return AGENT_LANGUAGES[code] ?? code;
}

/** Validate that a code is in the catalogue. */
export function isValidLanguage(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(AGENT_LANGUAGES, code);
}
