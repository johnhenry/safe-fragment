import { SafeFragmentError, isSafeFragmentError } from "../errors.js";

/** The `src`-fetch capability model. Disabled by default -- an application must opt in explicitly via `registerSafeFragment({ fetch: { enabled: true, ... } })`. */
export interface FetchCapability {
  enabled: boolean;
  /** Cross-origin origins (e.g. `"https://cdn.example.com"`) allowed in addition to the page's own origin. Same-origin requests are always allowed once `enabled` is true; nothing else is, unless listed here. */
  allowedOrigins: readonly string[];
  /** Hard cap on response body size, in bytes. Enforced during streaming, not just via `Content-Length` (which an attacker-controlled or misconfigured server could omit or lie about). */
  maxBytes: number;
  /** Abort the fetch if it hasn't completed within this many milliseconds. */
  timeoutMs: number;
  /**
   * Opt in to following HTTP redirects. Off by default (`redirect: "error"`).
   * When on, the final `response.url` origin is re-validated against the
   * same-origin/`allowedOrigins` policy after the fetch, and a redirect to
   * any other origin rejects with `FETCH_REDIRECT_NOT_ALLOWED`.
   */
  followRedirects: boolean;
}

export const DEFAULT_FETCH_CAPABILITY: FetchCapability = Object.freeze({
  enabled: false,
  allowedOrigins: Object.freeze([]),
  maxBytes: 250_000,
  timeoutMs: 8_000,
  followRedirects: false,
});

function combineSignals(signals: AbortSignal[]): AbortSignal {
  const AnyCapableAbortSignal = AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal };
  if (typeof AnyCapableAbortSignal.any === "function") {
    return AnyCapableAbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/** Abort reason an element uses when a newer render supersedes an in-flight fetch. Any other abort reason surfaces as `FETCH_ABORTED`. */
export const ABORT_SUPERSEDED = "safe-fragment:superseded";

function isOriginAllowed(origin: string, pageOrigin: string | undefined, capability: FetchCapability): boolean {
  return (pageOrigin !== undefined && origin === pageOrigin) || capability.allowedOrigins.includes(origin);
}

/**
 * Fetches and returns the raw text body of `rawUrl`, subject to the
 * capability model: disabled by default, GET-only (not configurable --
 * there is no parameter to request another method), same-origin unless
 * `capability.allowedOrigins` explicitly lists the target origin,
 * size-capped (checked both via `Content-Length` up front and while
 * streaming, since a header can lie or be absent), and time-limited.
 *
 * `callerSignal` is the render's own `AbortSignal` -- when a newer
 * `render()` call supersedes this one, the caller aborts `callerSignal`
 * with reason `ABORT_SUPERSEDED` (-> `FETCH_SUPERSEDED`); any other abort
 * (clear, disable, disconnect) surfaces as `FETCH_ABORTED`. Either way the
 * signal is folded in immediately so an in-flight fetch for a stale render
 * can never resolve after (and overwrite the output of) a newer one.
 */
export async function fetchSource(doc: Document, rawUrl: string, capability: FetchCapability, callerSignal: AbortSignal): Promise<string> {
  if (!capability.enabled) {
    throw new SafeFragmentError(
      "FETCH_DISABLED",
      "The `src` remote-fetch source is disabled. Enable it via registerSafeFragment({ fetch: { enabled: true, allowedOrigins: [...] } }).",
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl, doc.baseURI);
  } catch (cause) {
    throw new SafeFragmentError("FETCH_FAILED", `"src" is not a resolvable URL.`, { cause });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SafeFragmentError("FETCH_ORIGIN_NOT_ALLOWED", `Scheme "${url.protocol}" is not fetchable; only http(s) URLs are allowed.`);
  }

  const pageOrigin = doc.defaultView?.location?.origin;
  if (!isOriginAllowed(url.origin, pageOrigin, capability)) {
    throw new SafeFragmentError(
      "FETCH_ORIGIN_NOT_ALLOWED",
      `Origin "${url.origin}" is not the page's own origin and is not in the configured allowedOrigins allowlist.`,
      {
        details: { origin: url.origin },
      },
    );
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), capability.timeoutMs);
  const signal = combineSignals([callerSignal, timeoutController.signal]);

  // The timeout stays armed until the body has been fully read (cleared in
  // `finally`), so a server that sends headers and then stalls the body
  // cannot hold a render open forever.
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      // Redirects are an SSRF-ish/open-redirect hole by default: a same-origin
      // endpoint (or an allowed CDN) that 302s elsewhere would otherwise make
      // an unlisted origin's markup render. Opt in via followRedirects.
      redirect: capability.followRedirects ? "follow" : "error",
      credentials: "same-origin",
      signal,
    });

    if (capability.followRedirects && response.url !== "") {
      let finalOrigin: string;
      try {
        finalOrigin = new URL(response.url).origin;
      } catch (cause) {
        void response.body?.cancel().catch(() => {});
        throw new SafeFragmentError("FETCH_REDIRECT_NOT_ALLOWED", "The response URL after redirects could not be parsed.", { cause });
      }
      if (!isOriginAllowed(finalOrigin, pageOrigin, capability)) {
        void response.body?.cancel().catch(() => {});
        throw new SafeFragmentError(
          "FETCH_REDIRECT_NOT_ALLOWED",
          `The fetch was redirected to "${finalOrigin}", which is not the page's own origin and is not in allowedOrigins.`,
          { details: { origin: finalOrigin } },
        );
      }
    }

    if (!response.ok) {
      throw new SafeFragmentError("FETCH_NON_2XX", `Fetch returned HTTP ${response.status}.`, { details: { status: response.status } });
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const declared = Number(contentLengthHeader);
      if (Number.isFinite(declared) && declared > capability.maxBytes) {
        throw new SafeFragmentError("FETCH_SIZE_EXCEEDED", `Content-Length (${declared} bytes) exceeds the ${capability.maxBytes}-byte cap.`);
      }
    }

    if (!response.body) {
      const text = await response.text();
      if (text.length > capability.maxBytes) {
        throw new SafeFragmentError("FETCH_SIZE_EXCEEDED", `Response body exceeds the ${capability.maxBytes}-byte cap.`);
      }
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let result = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > capability.maxBytes) {
        await reader.cancel("size-cap-exceeded").catch(() => {});
        throw new SafeFragmentError("FETCH_SIZE_EXCEEDED", `Response body exceeded the ${capability.maxBytes}-byte cap while streaming.`);
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } catch (cause) {
    if (isSafeFragmentError(cause)) throw cause;
    // Anything else is a network or abort failure -- including one that
    // happens mid-stream, after the headers arrived.
    if (callerSignal.aborted) {
      if (callerSignal.reason === ABORT_SUPERSEDED) {
        throw new SafeFragmentError("FETCH_SUPERSEDED", "Fetch was superseded by a newer render() call.", { cause });
      }
      throw new SafeFragmentError("FETCH_ABORTED", "Fetch was aborted (element cleared, disabled or disconnected).", { cause });
    }
    if (timeoutController.signal.aborted) {
      throw new SafeFragmentError("FETCH_TIMEOUT", `Fetch exceeded the ${capability.timeoutMs}ms timeout.`, { cause });
    }
    throw new SafeFragmentError("FETCH_FAILED", "Network request failed.", { cause });
  } finally {
    clearTimeout(timeoutId);
  }
}
