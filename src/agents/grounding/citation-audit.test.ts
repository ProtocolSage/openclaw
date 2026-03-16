import { describe, expect, it } from "vitest";
import { auditCitationMiss } from "./citation-audit.js";
import { GROUNDING_POLICY } from "./policy.js";

describe("GROUNDING_POLICY", () => {
  it("stays compact enough for prompt injection", () => {
    expect(GROUNDING_POLICY.length).toBeLessThanOrEqual(200);
  });
});

describe("auditCitationMiss", () => {
  it("never throws on nullish or empty inputs", () => {
    expect(() => auditCitationMiss({ assistantText: null })).not.toThrow();
    expect(() => auditCitationMiss({ assistantText: undefined })).not.toThrow();
    expect(() => auditCitationMiss({ assistantText: "" })).not.toThrow();
    expect(auditCitationMiss({ assistantText: null })).toBe(false);
    expect(auditCitationMiss({ assistantText: undefined })).toBe(false);
    expect(auditCitationMiss({ assistantText: "" })).toBe(false);
  });

  it("flags grounded-claim patterns when memory_search was not called", () => {
    expect(
      auditCitationMiss({
        assistantText: "The config is at src/config/config.ts and you told me to keep it local.",
        toolNamesCalled: ["read"],
      }),
    ).toBe(true);
  });

  it("does not flag when memory_search was called this turn", () => {
    expect(
      auditCitationMiss({
        assistantText: "The codebase says this path is configured already.",
        toolNamesCalled: ["memory_search", "memory_get"],
      }),
    ).toBe(false);
  });

  it("ignores ordinary replies without claim patterns", () => {
    expect(
      auditCitationMiss({
        assistantText: "I can handle that next.",
        toolNamesCalled: [],
      }),
    ).toBe(false);
  });
});
