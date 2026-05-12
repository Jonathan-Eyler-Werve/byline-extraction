import { describe, it, expect } from "vitest";
import { classifyFetchError } from "../src/fetchError.js";

describe("classifyFetchError", () => {
  it("returns 'timeout' for AbortError", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyFetchError(err)).toBe("timeout");
  });

  it("returns 'timeout' for TimeoutError (alternate Node naming)", () => {
    const err = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(classifyFetchError(err)).toBe("timeout");
  });

  it("returns 'network' for TypeError with message 'fetch failed'", () => {
    const err = new TypeError("fetch failed");
    expect(classifyFetchError(err)).toBe("network");
  });

  it("passes through pre-formatted HTTP error messages unchanged", () => {
    const err = new Error("403 Forbidden");
    expect(classifyFetchError(err)).toBe("403 Forbidden");
  });

  it("passes through bare status when statusText is empty", () => {
    const err = new Error("418");
    expect(classifyFetchError(err)).toBe("418");
  });

  it("passes through unknown Error messages as last-resort fallback", () => {
    const err = new Error("something weird happened");
    expect(classifyFetchError(err)).toBe("something weird happened");
  });

  it("stringifies non-Error throws", () => {
    expect(classifyFetchError("just a string")).toBe("just a string");
    expect(classifyFetchError(42)).toBe("42");
    expect(classifyFetchError(null)).toBe("null");
  });
});
