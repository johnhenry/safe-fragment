import { describe, it, expect } from "vitest";
import { defineProfile, getProfile, listProfiles } from "../../src/policy/registry.js";

describe("profile registry", () => {
  it("seeds the four built-in profiles", () => {
    const names = listProfiles();
    expect(names).toEqual(expect.arrayContaining(["plain-text-v1", "article-v1", "ui-v1", "email-v1"]));
  });

  it("getProfile returns undefined for an unknown profile", () => {
    expect(getProfile("does-not-exist-v1")).toBeUndefined();
  });

  it("defineProfile throws for an unregistered profile name", () => {
    expect(() => defineProfile("nonexistent-v1", { customElements: [] })).toThrow(RangeError);
  });

  it("defineProfile throws when registering custom elements against a profile that disallows them", () => {
    expect(() => defineProfile("article-v1", { customElements: [{ tag: "my-widget", attributes: [] }] })).toThrow(RangeError);
  });

  it("defineProfile throws for a custom element tag without a hyphen", () => {
    expect(() => defineProfile("ui-v1", { customElements: [{ tag: "notvalid", attributes: [] }] })).toThrow(RangeError);
  });

  it("defineProfile accepts a valid custom element registration on ui-v1", () => {
    expect(() => defineProfile("ui-v1", { customElements: [{ tag: "my-registry-widget", attributes: ["role"] }] })).not.toThrow();
  });
});
