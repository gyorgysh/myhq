import { AuthError, ApiError } from "../api.ts";
import type { TranslationKey } from "../i18n/en.ts";

/**
 * Map an arbitrary thrown value to a friendly, translated, actionable message.
 *
 * Views used to surface raw strings like `Error: /api/tasks → 500` or
 * `TypeError: Failed to fetch`. This routes every error through the semantic
 * `err_*` i18n keys so the copy is localized and tells the user what to do
 * next. Pass the `t` from `useI18n()`.
 *
 * `AuthError` is normally intercepted by callers (to trigger re-login) before
 * it reaches here, but we still map it for completeness.
 */
export function errorMessage(e: unknown, t: (k: TranslationKey) => string): string {
  if (e instanceof AuthError) return t("err_session_expired");

  if (e instanceof ApiError) {
    if (e.status === 429) return t("err_rate_limited");
    if (e.status === 404) return t("err_not_found");
    if (e.status === 401) return t("err_session_expired");
    if (e.status === 403) return t("err_forbidden");
    if (e.status >= 500) return t("err_server");
    if (e.status >= 400) return t("err_bad_request");
    return t("err_generic");
  }

  // fetch() rejects with a TypeError when the network is unreachable (offline,
  // DNS failure, server down mid-request). Detect it by shape rather than
  // string, since the message text is browser-specific and unlocalized.
  if (e instanceof TypeError) return t("err_network");

  return t("err_generic");
}
