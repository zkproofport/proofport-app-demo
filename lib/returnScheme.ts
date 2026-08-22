/**
 * Where ZKProofport hands control back to once a proof request started by this
 * demo is finished.
 *
 * `returnScheme` is deliberately NOT a URL. The relay
 * (`proofport-relay/src/returnScheme.ts` — the authority; re-implemented for
 * fail-fast DX in `proofport-app-sdk/src/deeplink.ts` and, defensively, in
 * `proofport-app/src/utils/deeplink.ts`) accepts exactly two shapes:
 *
 *   1. a bare custom scheme   `mydapp://`
 *   2. a bare https origin    `https://host[:port]`  — no path, query,
 *      fragment or userinfo
 *
 * TWO conditions must hold before the demo sends one.
 *
 * 1. THE PROVER MUST BE THE REQUESTER'S DEVICE.
 *    The demo runs two flows. On mobile the user taps through to the app on the
 *    same phone, and switching back to this page when the proof is done is the
 *    whole point. On desktop the user scans a QR code, so the proof happens on
 *    a *different* device while the result screen they are watching stays on
 *    the desktop — which updates on its own over the relay socket. A
 *    returnScheme there would pop `https://demo.zkproofport.app` open in mobile
 *    Safari: a page nobody asked for, on the wrong device. So the field is
 *    omitted for the desktop QR flow. The device answer comes from
 *    `lib/device.ts`, the same helper `showProofResult()` uses to pick QR vs
 *    "Open App", so the two decisions cannot drift apart.
 *
 * 2. THE ORIGIN MUST BE A SHAPE THE RELAY ACCEPTS.
 *    The demo is a web page, so the only value it can legitimately produce is
 *    the https origin it is served from. That origin is read at call time
 *    rather than baked in per environment, so one build returns to
 *    `https://stg-demo.zkproofport.app` on staging and
 *    `https://demo.zkproofport.app` in production with no env var and no
 *    branch. Local development is served over cleartext http
 *    (`http://localhost:3300`, `http://192.168.x.x:3300`) and `http` is on the
 *    relay's denied list, so a dev origin has no valid representation.
 *
 * When either condition fails the optional field is simply not sent, and the
 * reason is logged. That is not a fallback: nothing is guessed, no environment
 * is assumed, no literal is hardcoded, and the reason is visible in the console
 * instead of the feature silently doing nothing.
 */
import { isMobileDevice } from './device';

/** Longest accepted value. Mirrors MAX_RETURN_SCHEME_LENGTH in the relay. */
export const MAX_RETURN_SCHEME_LENGTH = 128;

/**
 * `https://host[:port]` with no userinfo, path, query or fragment.
 * Byte-for-byte the relay's HTTPS_ORIGIN_RE — keep the two in sync.
 */
const HTTPS_ORIGIN_RE =
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$/;

export interface ReturnSchemeDerivation {
  /** Present only when the value is one the relay will accept. */
  returnScheme?: string;
  /** Present only when it is not, explaining why in one sentence. */
  reason?: string;
}

/**
 * Origin half of the derivation, kept pure so every branch is testable without
 * a DOM.
 *
 * @param origin - the page origin, i.e. `window.location.origin`. `undefined`,
 *   `null`, `''` and the literal `'null'` (opaque origin inside a sandboxed
 *   iframe) are each treated as "no usable origin", with their own reason.
 */
export function deriveReturnScheme(origin: unknown): ReturnSchemeDerivation {
  if (origin === undefined || origin === null) {
    return { reason: 'the page origin is unavailable' };
  }
  if (typeof origin !== 'string') {
    return { reason: `the page origin is not a string (${typeof origin})` };
  }
  if (origin.length === 0) {
    return { reason: 'the page origin is empty' };
  }
  // A sandboxed iframe serialises its opaque origin as the string "null".
  if (origin === 'null') {
    return { reason: 'the page has an opaque origin (sandboxed iframe)' };
  }
  // Length is checked before the regex so a pathological value never reaches
  // the pattern matcher — same ordering as the relay validator.
  if (origin.length > MAX_RETURN_SCHEME_LENGTH) {
    return {
      reason: `the page origin is longer than ${MAX_RETURN_SCHEME_LENGTH} characters`,
    };
  }
  if (/\s/.test(origin)) {
    return { reason: 'the page origin contains whitespace' };
  }

  // The relay lowercases before matching; do the same so the value we send is
  // already the value it will store.
  const normalized = origin.toLowerCase();

  if (!normalized.startsWith('https://')) {
    return {
      reason: `"${origin}" is not https — the relay rejects cleartext return targets, so local http development cannot switch back`,
    };
  }
  if (!HTTPS_ORIGIN_RE.test(normalized)) {
    return {
      reason: `"${origin}" is not a bare https origin (host with a dot, optional port, no path/query/fragment/userinfo)`,
    };
  }

  return { returnScheme: normalized };
}

/**
 * Full decision, pure: device flow first, then origin shape.
 *
 * @param flow.isMobile - true when the prover will be this same device.
 * @param flow.origin - `window.location.origin`.
 */
export function resolveReturnScheme(flow: {
  isMobile: boolean;
  origin: unknown;
}): ReturnSchemeDerivation {
  if (!flow.isMobile) {
    return {
      reason:
        'this is the desktop QR flow — the proof runs on a different device, and this page updates over the relay socket instead',
    };
  }
  return deriveReturnScheme(flow.origin);
}

/**
 * The value to pass as `createRelayRequest`'s `returnScheme` option, or
 * `undefined` when this request has no app to hand control back to.
 *
 * Safe to call during SSR: `page.tsx` is a client component but still renders
 * on the server, where neither `window` nor `navigator` exists.
 */
export function getReturnSchemeForRequest(): string | undefined {
  if (typeof window === 'undefined') {
    // Server render. No browser to return to — and no request is created here
    // either, since every call site runs from a click handler.
    return undefined;
  }

  const { returnScheme, reason } = resolveReturnScheme({
    isMobile: isMobileDevice(),
    origin: window.location?.origin,
  });

  console.log(
    returnScheme
      ? `[returnScheme] ZKProofport will switch back to ${returnScheme}`
      : `[returnScheme] no app switch on this request: ${reason}`,
  );

  return returnScheme;
}
