import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { exportPlainText, importPlainText, isSafePortableLink } from "./portableFormats";
import { createTemplateDocument, DOCUMENT_TEMPLATES } from "./templates";

describe("plain text portability", () => {
  it("keeps markup-looking text, tabs, repeated spaces, Unicode and empty paragraphs as literal content", () => {
    const source = '\uFEFF<script>alert("x")</script>\r\n\r\n한글  café\t🙏\r마지막\n';
    const result = importPlainText(source);
    const schema = getSchema([StarterKit]);
    const doc = schema.nodeFromJSON(result.content);
    expect(doc.childCount).toBe(5);
    expect(doc.child(0).textContent).toBe('<script>alert("x")</script>');
    expect(doc.child(1).textContent).toBe("");
    expect(doc.child(2).textContent).toBe("한글  café\t🙏");
    expect(doc.child(3).textContent).toBe("마지막");
    expect(doc.child(4).textContent).toBe("");
  });

  it("produces UTF-8 Korean text with a BOM and stable newlines", async () => {
    const blob = exportPlainText("한글\r\n둘째\r셋째");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(await blob.text()).toBe("한글\n둘째\n셋째");
  });
});

describe("portable link policy", () => {
  it("keeps ordinary web, email and fragment links", () => {
    for (const value of ["https://example.org/path?q=가톨릭", "http://example.org", "mailto:office@example.org", "#chapter-1"]) expect(isSafePortableLink(value)).toBe(true);
  });

  it("rejects active content, local files, protocol-relative URLs and control-character obfuscation", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,test", "file:///c:/private.txt", "//example.org/track", "java\nscript:alert(1)", "https://example.org\n@evil.test", ""]) expect(isSafePortableLink(value)).toBe(false);
  });
});

describe("template document isolation", () => {
  it("returns fresh page settings so editing one document cannot alter future templates", () => {
    const first = createTemplateDocument("meeting");
    first.pageSettings.margins.top = 80;
    first.pageSettings.header = "수정된 문서";
    const second = createTemplateDocument("meeting");
    expect(second.pageSettings.margins.top).toBe(20);
    expect(second.pageSettings.header).toBe("회의록");
    expect(DOCUMENT_TEMPLATES).toHaveLength(6);
  });

  it("rejects an unknown template instead of replacing a document with an empty value", () => {
    expect(() => createTemplateDocument("missing")).toThrow("서식을 찾을 수 없습니다");
  });
});
