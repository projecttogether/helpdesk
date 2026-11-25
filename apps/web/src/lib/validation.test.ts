import { describe, expect, it } from "vitest";
import { issueMessage } from "./validation";

describe("validation messages", () => {
  it("replaces zod's own messages with plain ones", () => {
    expect(issueMessage({ code: "too_small", origin: "string", minimum: 1 })).toBe("Required");
    expect(issueMessage({ code: "too_big", origin: "string", maximum: 80 })).toBe("At most 80 characters");
    expect(issueMessage({ code: "too_big", origin: "number", maximum: 20 })).toBe("At most 20");
    expect(issueMessage({ code: "invalid_format", format: "url" })).toMatch(/^Enter a full address/);
    expect(issueMessage({ code: "invalid_type", expected: "number", input: Number.NaN })).toBe(
      "Enter a number",
    );
  });
});
