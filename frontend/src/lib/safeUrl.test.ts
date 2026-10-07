import { describe, expect, it } from "vitest";
import { safeHref } from "./safeUrl";

describe("safeHref", () => {
  it.each([
    ["https://linkedin.com/in/jane", "https://linkedin.com/in/jane"],
    ["http://example.com/x", "http://example.com/x"],
    ["https://meet.google.com/abc-defg-hij", "https://meet.google.com/abc-defg-hij"],
  ])("keeps web links: %s", (url, expected) => {
    expect(safeHref(url)).toBe(expected);
  });

  it.each([
    "javascript:alert(document.cookie)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "linkedin.com/in/jane", // not a full address
    "",
    null,
    undefined,
  ])("drops anything else: %s", (url) => {
    expect(safeHref(url)).toBeUndefined();
  });
});
