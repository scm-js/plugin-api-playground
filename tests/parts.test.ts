import { deflateRawSync } from "node:zlib";
import ts from "typescript";
import { decodeSnippet, encodeSnippet, snippetLink } from "../link";
import { describe, expect, it } from "vitest";
import { detail, expandable, preview } from "../inspect";
import { moduleText, prelude, stackLine } from "../run";
import { lineTable, originalLine } from "../sourcemap";
import { idFromName, linesInsideTemplates, snippetToPlugin, starterFiles } from "../starter";
import { crc32, zip } from "../zip";

describe("source maps", () => {
  it("map an emitted line back to the snippet line, across dropped type-only lines", () => {
    const source = ["interface P { x: number }", "type Q = string;", "", "const p: P = { x: 1 };", "throw new Error(String(p.x));"].join("\n");
    const out = ts.transpileModule(source, { compilerOptions: { sourceMap: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, fileName: "snippet.ts" });
    const js = out.outputText.split("\n");
    const throwAt = js.findIndex((l) => l.startsWith("throw")) + 1;
    const table = lineTable(JSON.parse(out.sourceMapText!).mappings);
    expect(throwAt).toBeLessThan(5);
    expect(originalLine(table, throwAt)).toBe(5);
    expect(originalLine(table, js.findIndex((l) => l.startsWith("const p")) + 1)).toBe(4);
  });
});

describe("running", () => {
  it("puts the prelude on the snippet's first line, and the source map inline", () => {
    const text = moduleText("run-1", "console.log(1);\n//# sourceMappingURL=snippet.js.map", '{"mappings":"AAAA"}');
    const lines = text.split("\n");
    expect(lines[0].startsWith(prelude("run-1"))).toBe(true);
    expect(lines[0].endsWith("console.log(1);")).toBe(true);
    expect(text).not.toContain("snippet.js.map");
    expect(text).toMatch(/sourceMappingURL=data:application\/json;base64,/);
  });

  it("reads the line of a stack frame in the snippet's module", () => {
    const url = "blob:http://localhost/abc";
    expect(stackLine(`Error: x\n    at f (${url}:7:12)\n    at other.js:1:1`, url)).toBe(7);
    expect(stackLine("Error: x\n    at other.js:1:1", url)).toBeNull();
  });
});

describe("the inspector", () => {
  it("previews on one line and lays out in detail", () => {
    expect(preview("plain")).toBe("plain");
    expect(preview({ a: 1, b: [1, 2], c: "x" })).toBe('{ a: 1, b: [ 1, 2 ], c: "x" }');
    expect(detail({ a: { b: 1 } })).toBe("{\n  a: {\n    b: 1\n  }\n}");
    expect(preview(new Map([["k", 1]]))).toBe('Map(1) { "k" => 1 }');
    expect(preview(new Uint8Array([1, 2]))).toBe("Uint8Array(2) [ 1, 2 ]");
    expect(expandable({})).toBe(true);
    expect(expandable(3)).toBe(false);
  });

  it("stops at cycles, depth and length", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(preview(a)).toBe("{ self: [circular] }");
    expect(preview({ a: { b: { c: { d: 1 } } } })).toBe("{ a: { b: {…} } }");
    expect(preview(Array.from({ length: 60 }, (_, i) => i), 1000)).toMatch(/… 10 more \]$/);
    expect(preview("x".repeat(20), 10)).toBe("xxxxxxxxx…");
  });
});

describe("the starter plugin", () => {
  it("makes an id the way the editor does", () => {
    expect(idFromName("My Great Plugin!")).toBe("my-great-plugin");
    expect(idFromName("  ")).toBe("plugin");
  });

  it("leaves the inside of a template literal alone", () => {
    const code = "const a = `one\n  two ${x + `in\nner`}\nthree`;\nconst b = 'x`';\n// `\nc();";
    expect(linesInsideTemplates(code)).toEqual([false, true, true, true, false, false, false]);
  });

  it("wraps the snippet in activate, hoists its imports and keeps template text as it was", () => {
    const code = [
      'import type { EditTransaction } from "@scm-js/plugin-api";',
      "export const n = 2;",
      "const text = `line",
      "  indented`;",
      "await api.ui.alert(text + n);",
    ].join("\n");
    const out = snippetToPlugin(code, "Demo");
    expect(out).toContain('import type { PluginApi } from "@scm-js/plugin-api";\nimport type { EditTransaction } from "@scm-js/plugin-api";');
    expect(out).toContain("export default async function activate(api: PluginApi) {\n  const n = 2;\n  const text = `line\n  indented`;\n  await api.ui.alert(text + n);\n}");
  });

  it("type-checks as a plugin", () => {
    const files = starterFiles({ name: "Demo", id: "demo", description: "d", author: "", code: "api.menu.add(\"Tools\", { label: \"Hi\", run: () => api.log(1) });", typesVersion: "1.35.0" });
    expect(Object.keys(files).sort()).toEqual([".gitignore", "README.md", "package.json", "plugin.json", "plugin.ts", "tsconfig.json"]);
    expect(JSON.parse(files["plugin.json"])).toMatchObject({ name: "Demo", id: "demo", entry: "plugin.ts", api: 1 });
    expect(JSON.parse(files["package.json"]).devDependencies["@scm-js/plugin-api"]).toBe("^1.35.0");
    const out = ts.transpileModule(files["plugin.ts"], { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
    expect(out.diagnostics).toEqual([]);
    expect(files["plugin.ts"]).not.toMatch(/async function/);
  });
});

describe("the zip writer", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });

  it("writes members a reader can find by the central directory", () => {
    const bytes = zip({ "a/plugin.json": "{}", "a/한.txt": "hi" }, new Date(2026, 8, 23, 12, 0, 0));
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    let at = view.getUint32(end + 16, true);
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const len = view.getUint16(at + 28, true);
      names.push(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + len)));
      const local = view.getUint32(at + 42, true);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      at += 46 + len;
    }
    expect(names).toEqual(["a/plugin.json", "a/한.txt"]);
  });
});

describe("snippet links", () => {
  it("round-trip, and read what the docs site's build writes (Node's zlib)", async () => {
    const code = 'console.log("한글 ×", api.document.info());\n'.repeat(3);
    const param = await encodeSnippet(code);
    expect(param).toMatch(/^1[A-Za-z0-9_-]+$/);
    expect(await decodeSnippet(param)).toBe(code);
    const fromDocs = `1${deflateRawSync(Buffer.from(code, "utf8"), { level: 9 }).toString("base64url")}`;
    expect(await decodeSnippet(fromDocs)).toBe(code);
  });

  it("refuse anything else", async () => {
    expect(await decodeSnippet("2abc")).toBeNull();
    expect(await decodeSnippet("1!!!")).toBeNull();
    expect(await decodeSnippet("1AAAA")).toBeNull();
  });

  it("address the page they were made on", async () => {
    const link = await snippetLink("api.log(1);", { origin: "https://editor.scmjs.dev", pathname: "/" });
    expect(link).toMatch(/^https:\/\/editor\.scmjs\.dev\/\?playground=1/);
  });
});
