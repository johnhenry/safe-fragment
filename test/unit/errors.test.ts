import { describe, it, expect } from "vitest";
import { SafeFragmentError, isSafeFragmentError } from "../../src/errors.js";

describe("SafeFragmentError", () => {
  it("carries a stable code and message", () => {
    const err = new SafeFragmentError("UNKNOWN_PROFILE", "no such profile");
    expect(err.code).toBe("UNKNOWN_PROFILE");
    expect(err.message).toBe("no such profile");
    expect(err.name).toBe("SafeFragmentError");
  });

  it("is recognized by isSafeFragmentError", () => {
    expect(isSafeFragmentError(new SafeFragmentError("NO_SOURCE", "x"))).toBe(true);
    expect(isSafeFragmentError(new Error("plain error"))).toBe(false);
    expect(isSafeFragmentError(null)).toBe(false);
    expect(isSafeFragmentError(undefined)).toBe(false);
    expect(isSafeFragmentError("a string")).toBe(false);
  });

  it("carries optional details and cause", () => {
    const cause = new Error("root cause");
    const err = new SafeFragmentError("FETCH_FAILED", "network broke", { cause, details: { url: "https://example.com/" } });
    expect(err.cause).toBe(cause);
    expect(err.details).toEqual({ url: "https://example.com/" });
  });
});
