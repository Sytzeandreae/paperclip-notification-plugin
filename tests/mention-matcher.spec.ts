import { describe, it, expect } from "vitest";
import { matchesMention, extractExcerpt } from "../src/mention-matcher.js";

describe("matchesMention", () => {
  it("matches identifier at start of text", () => {
    expect(matchesMention("sytze is working on this", ["sytze"])).toBe(true);
  });

  it("matches identifier at end of text", () => {
    expect(matchesMention("assigned to sytze", ["sytze"])).toBe(true);
  });

  it("matches identifier in middle of text", () => {
    expect(matchesMention("hey sytze check this", ["sytze"])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesMention("Hey SYTZE check this", ["sytze"])).toBe(true);
  });

  it("matches @-prefixed identifiers", () => {
    expect(matchesMention("cc @sytze for review", ["@sytze"])).toBe(true);
  });

  it("does not match substring within a word", () => {
    expect(matchesMention("easy task", ["sy"])).toBe(false);
  });

  it("rejects identifiers shorter than 3 characters", () => {
    expect(matchesMention("sy is here", ["sy"])).toBe(false);
  });

  it("matches any identifier from the list", () => {
    expect(matchesMention("hello sytze_a", ["bob", "sytze_a"])).toBe(true);
  });

  it("returns false when no match", () => {
    expect(matchesMention("nothing here", ["sytze"])).toBe(false);
  });

  it("handles empty text", () => {
    expect(matchesMention("", ["sytze"])).toBe(false);
  });

  it("handles empty identifiers list", () => {
    expect(matchesMention("sytze is here", [])).toBe(false);
  });
});

describe("extractExcerpt", () => {
  it("extracts context around first match", () => {
    const text = "This is a long description where sytze is mentioned somewhere in the middle of it all.";
    const result = extractExcerpt(text, ["sytze"]);
    expect(result).toContain("sytze");
    expect(result.length).toBeLessThanOrEqual(110);
  });

  it("returns first 100 chars when no identifiers provided", () => {
    const text = "A".repeat(200);
    const result = extractExcerpt(text, []);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it("handles match at start of text", () => {
    const text = "sytze started the project and continued working on it for many days.";
    const result = extractExcerpt(text, ["sytze"]);
    expect(result).toContain("sytze");
  });

  it("handles match at end of text", () => {
    const text = "The project was started by sytze";
    const result = extractExcerpt(text, ["sytze"]);
    expect(result).toContain("sytze");
  });
});
