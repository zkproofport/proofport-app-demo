/**
 * Single source of truth for "is this page running on a phone / tablet?".
 *
 * Two independent decisions hang off this answer and must never disagree:
 *   1. how the proof request is presented — mobile gets an "Open App" deep-link
 *      button, desktop gets a QR code (`showProofResult` in `app/page.tsx`);
 *   2. whether the request carries a `returnScheme` at all — see
 *      `lib/returnScheme.ts`.
 *
 * They stay consistent by both calling this one function. Do not re-derive the
 * device from `navigator.userAgent` anywhere else.
 */
const MOBILE_UA_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

/**
 * @param userAgent - override, for tests. Defaults to `navigator.userAgent`.
 *   Returns false when there is no navigator at all (server render).
 */
export function isMobileDevice(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator === 'undefined' ? undefined : navigator.userAgent);
  if (!ua) return false;
  return MOBILE_UA_RE.test(ua);
}
