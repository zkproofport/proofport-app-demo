/**
 * Single source of truth for "is this page running on a phone / tablet?".
 *
 * It decides how the proof request is presented: mobile gets an "Open App"
 * deep-link button, desktop gets a QR code (`showProofResult` in
 * `app/page.tsx`). Do not re-derive the device from `navigator.userAgent`
 * anywhere else on the page.
 *
 * It used to have a second consumer, `lib/returnScheme.ts`, which decided
 * whether the request should carry a `returnScheme`. That module is gone: the
 * only value a web page could produce was its own https origin, and opening one
 * lands the user in a NEW browser tab rather than the tab they started in. The
 * demo now sends no `returnScheme` at all and the SDK decides — see the long
 * note at the first `createRelayRequest` call site in `app/page.tsx`.
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
