import { describe, expect, it } from "vitest";
import { escapeHtml } from "../html";

describe("escapeHtml", () => {
  it("escapes HTML-sensitive characters", () => {
    expect(escapeHtml(`<script>alert("x") & more</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; more&lt;/script&gt;"
    );
  });

  it("leaves plain Korean text untouched", () => {
    expect(escapeHtml("서울 동작구 사당동 317-6")).toBe("서울 동작구 사당동 317-6");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(escapeHtml("<<>>")).toBe("&lt;&lt;&gt;&gt;");
  });
});
