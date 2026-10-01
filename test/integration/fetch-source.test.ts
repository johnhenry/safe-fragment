import { describe, it, expect, afterEach } from "vitest";
import { fetchSource, DEFAULT_FETCH_CAPABILITY, ABORT_SUPERSEDED, type FetchCapability } from "../../src/source/fetch.js";
import { isSafeFragmentError } from "../../src/errors.js";

/**
 * Exercises the `src` fetch capability model against a mocked
 * `globalThis.fetch` rather than a real network server: deterministic,
 * avoids real-network flakiness in CI, and lets tests precisely control
 * response timing/size/headers for the abort/timeout/size-cap paths that
 * are hardest to trigger reliably against a real server.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOnce(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = impl as typeof fetch;
}

function abortableNever(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

function stallingBody(signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    },
  });
}

function responseWithUrl(body: string, url: string): Response {
  const res = new Response(body, { status: 200 });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

function cap(overrides: Partial<FetchCapability>): FetchCapability {
  return { ...DEFAULT_FETCH_CAPABILITY, ...overrides };
}

describe("fetchSource", () => {
  it("rejects with FETCH_DISABLED when the capability is disabled (the default)", async () => {
    let called = false;
    mockFetchOnce(async () => {
      called = true;
      return new Response("hi");
    });
    await expect(fetchSource(document, "/x", cap({ enabled: false }), new AbortController().signal)).rejects.toMatchObject({ code: "FETCH_DISABLED" });
    expect(called).toBe(false);
  });

  it("rejects non-http(s) schemes outright without calling fetch", async () => {
    let called = false;
    mockFetchOnce(async () => {
      called = true;
      return new Response("hi");
    });
    await expect(fetchSource(document, "javascript:alert(1)", cap({ enabled: true }), new AbortController().signal)).rejects.toMatchObject({
      code: "FETCH_ORIGIN_NOT_ALLOWED",
    });
    expect(called).toBe(false);
  });

  it("allows a same-origin URL when enabled", async () => {
    mockFetchOnce(async () => new Response("<p>ok</p>", { status: 200 }));
    const url = new URL("/fixture", location.origin).toString();
    const text = await fetchSource(document, url, cap({ enabled: true }), new AbortController().signal);
    expect(text).toBe("<p>ok</p>");
  });

  it("rejects a cross-origin URL not in allowedOrigins", async () => {
    mockFetchOnce(async () => new Response("hi"));
    await expect(
      fetchSource(document, "https://cross-origin-test.example/x", cap({ enabled: true, allowedOrigins: [] }), new AbortController().signal),
    ).rejects.toMatchObject({ code: "FETCH_ORIGIN_NOT_ALLOWED" });
  });

  it("allows a cross-origin URL explicitly in allowedOrigins", async () => {
    mockFetchOnce(async () => new Response("cross-origin ok"));
    const text = await fetchSource(
      document,
      "https://cross-origin-test.example/x",
      cap({ enabled: true, allowedOrigins: ["https://cross-origin-test.example"] }),
      new AbortController().signal,
    );
    expect(text).toBe("cross-origin ok");
  });

  it("always fetches with GET, regardless of anything else", async () => {
    let seenMethod: string | undefined;
    mockFetchOnce(async (_input, init) => {
      seenMethod = init?.method;
      return new Response("ok");
    });
    await fetchSource(document, "/x", cap({ enabled: true }), new AbortController().signal);
    expect(seenMethod).toBe("GET");
  });

  it("rejects non-2xx responses with FETCH_NON_2XX", async () => {
    mockFetchOnce(async () => new Response("nope", { status: 404 }));
    await expect(fetchSource(document, "/x", cap({ enabled: true }), new AbortController().signal)).rejects.toMatchObject({ code: "FETCH_NON_2XX" });
  });

  it("rejects when Content-Length exceeds the byte cap", async () => {
    mockFetchOnce(async () => new Response("x", { status: 200, headers: { "content-length": "999999" } }));
    await expect(fetchSource(document, "/x", cap({ enabled: true, maxBytes: 10 }), new AbortController().signal)).rejects.toMatchObject({
      code: "FETCH_SIZE_EXCEEDED",
    });
  });

  it("rejects when the streamed body exceeds the byte cap even without a Content-Length header", async () => {
    const bigChunk = new Uint8Array(1000).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bigChunk);
        controller.close();
      },
    });
    mockFetchOnce(async () => new Response(stream, { status: 200 }));
    await expect(fetchSource(document, "/x", cap({ enabled: true, maxBytes: 10 }), new AbortController().signal)).rejects.toMatchObject({
      code: "FETCH_SIZE_EXCEEDED",
    });
  });

  it("rejects with FETCH_TIMEOUT when the request exceeds timeoutMs", async () => {
    mockFetchOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    await expect(fetchSource(document, "/x", cap({ enabled: true, timeoutMs: 20 }), new AbortController().signal)).rejects.toMatchObject({
      code: "FETCH_TIMEOUT",
    });
  });

  it("rejects with FETCH_SUPERSEDED when the caller's own signal aborts (a newer render superseded this fetch)", async () => {
    const controller = new AbortController();
    mockFetchOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const promise = fetchSource(document, "/x", cap({ enabled: true, timeoutMs: 5000 }), controller.signal);
    controller.abort(ABORT_SUPERSEDED);
    await expect(promise).rejects.toMatchObject({ code: "FETCH_SUPERSEDED" });
  });

  it("a plain abort (clear/disable/disconnect) is FETCH_ABORTED, never FETCH_SUPERSEDED", async () => {
    const controller = new AbortController();
    mockFetchOnce(abortableNever);
    const promise = fetchSource(document, "/x", cap({ enabled: true, timeoutMs: 5000 }), controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "FETCH_ABORTED" });
  });

  describe("redirects", () => {
    it("defaults to redirect: error", async () => {
      let seen: RequestRedirect | undefined;
      mockFetchOnce(async (_i, init) => {
        seen = init?.redirect;
        return new Response("ok");
      });
      await fetchSource(document, "/x", cap({ enabled: true }), new AbortController().signal);
      expect(seen).toBe("error");
      expect(DEFAULT_FETCH_CAPABILITY.followRedirects).toBe(false);
    });

    it("a redirect:error network failure surfaces as FETCH_FAILED", async () => {
      mockFetchOnce(async () => {
        throw new TypeError("Failed to fetch");
      });
      await expect(fetchSource(document, "/x", cap({ enabled: true }), new AbortController().signal)).rejects.toMatchObject({ code: "FETCH_FAILED" });
    });

    it("followRedirects: true uses redirect: follow", async () => {
      let seen: RequestRedirect | undefined;
      mockFetchOnce(async (_i, init) => {
        seen = init?.redirect;
        return responseWithUrl("ok", new URL("/y", location.origin).toString());
      });
      const text = await fetchSource(document, "/x", cap({ enabled: true, followRedirects: true }), new AbortController().signal);
      expect(seen).toBe("follow");
      expect(text).toBe("ok");
    });

    it("followRedirects: true re-validates response.url and rejects an unlisted origin", async () => {
      mockFetchOnce(async () => responseWithUrl("evil", "https://evil.example/landing"));
      await expect(fetchSource(document, "/x", cap({ enabled: true, followRedirects: true }), new AbortController().signal)).rejects.toMatchObject({
        code: "FETCH_REDIRECT_NOT_ALLOWED",
      });
    });

    it("followRedirects: true accepts a redirect to an allowedOrigins entry", async () => {
      mockFetchOnce(async () => responseWithUrl("fine", "https://cdn.example/landing"));
      const text = await fetchSource(
        document,
        "/x",
        cap({ enabled: true, followRedirects: true, allowedOrigins: ["https://cdn.example"] }),
        new AbortController().signal,
      );
      expect(text).toBe("fine");
    });
  });

  describe("body phase", () => {
    it("keeps the timeout armed while the body is read (stalled body -> FETCH_TIMEOUT)", async () => {
      mockFetchOnce(async (_i, init) => new Response(stallingBody(init?.signal), { status: 200 }));
      await expect(fetchSource(document, "/x", cap({ enabled: true, timeoutMs: 30 }), new AbortController().signal)).rejects.toMatchObject({
        code: "FETCH_TIMEOUT",
      });
    });

    it("maps a mid-stream network error to FETCH_FAILED, not a raw error", async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new TypeError("network error"));
        },
      });
      mockFetchOnce(async () => new Response(stream, { status: 200 }));
      await expect(fetchSource(document, "/x", cap({ enabled: true }), new AbortController().signal)).rejects.toMatchObject({ code: "FETCH_FAILED" });
    });

    it("maps a mid-stream caller abort to FETCH_ABORTED", async () => {
      const controller = new AbortController();
      mockFetchOnce(async (_i, init) => new Response(stallingBody(init?.signal), { status: 200 }));
      const promise = fetchSource(document, "/x", cap({ enabled: true, timeoutMs: 5000 }), controller.signal);
      setTimeout(() => controller.abort(), 10);
      await expect(promise).rejects.toMatchObject({ code: "FETCH_ABORTED" });
    });

    it("maps a mid-stream supersede to FETCH_SUPERSEDED", async () => {
      const controller = new AbortController();
      mockFetchOnce(async (_i, init) => new Response(stallingBody(init?.signal), { status: 200 }));
      const promise = fetchSource(document, "/x", cap({ enabled: true, timeoutMs: 5000 }), controller.signal);
      setTimeout(() => controller.abort(ABORT_SUPERSEDED), 10);
      await expect(promise).rejects.toMatchObject({ code: "FETCH_SUPERSEDED" });
    });
  });

  it("produces a real SafeFragmentError instance recognizable via isSafeFragmentError", async () => {
    try {
      await fetchSource(document, "/x", cap({ enabled: false }), new AbortController().signal);
      throw new Error("should have thrown");
    } catch (error) {
      expect(isSafeFragmentError(error)).toBe(true);
    }
  });
});
