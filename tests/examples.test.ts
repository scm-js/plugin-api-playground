import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../examples";
import { snippetToPlugin } from "../starter";

// Every example type-checked the way the playground's editor checks it: the plugin API's
// declarations as a package, `api` as a global, the DOM, and every file a module.
const require = createRequire(import.meta.url);
const TYPES = readFileSync(require.resolve("@scm-js/plugin-api/index.d.ts"), "utf8");
const GLOBALS = `declare const api: import("@scm-js/plugin-api").PluginApi;\n`;

/** `asPlugin`: the file is a starter's `plugin.ts`, checked with the starter's tsconfig and no global `api`. */
function check(code: string, asPlugin = false): string[] {
  const files = new Map<string, string>([
    ["/snippet.ts", code],
    ["/globals.d.ts", GLOBALS],
    ["/node_modules/@scm-js/plugin-api/index.d.ts", TYPES],
    ["/node_modules/@scm-js/plugin-api/package.json", JSON.stringify({ name: "@scm-js/plugin-api", types: "index.d.ts" })],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    noEmit: true,
    ...(asPlugin ? { noUnusedLocals: true, noUnusedParameters: true, verbatimModuleSyntax: true, isolatedModules: true, moduleDetection: ts.ModuleDetectionKind.Auto } : {}),
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), source = host.getSourceFile.bind(host);
  host.readFile = (f) => files.get(f) ?? read(f);
  host.fileExists = (f) => files.has(f) || exists(f);
  const dirExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => [...files.keys()].some((f) => f.startsWith(`${d.replace(/\/$/, "")}/`)) || (dirExists?.(d) ?? false);
  host.realpath = (p) => p;
  host.getSourceFile = (f, lang, ...rest) => (files.has(f) ? ts.createSourceFile(f, files.get(f)!, lang) : source(f, lang, ...rest));
  const program = ts.createProgram(asPlugin ? ["/snippet.ts"] : ["/snippet.ts", "/globals.d.ts"], options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ` : "";
    return where + ts.flattenDiagnosticMessageText(d.messageText, "\n");
  });
}

describe("the examples", () => {
  for (const ex of EXAMPLES) {
    it(`type-check: ${ex.title}`, () => {
      expect(check(ex.code)).toEqual([]);
    });
  }

  for (const ex of EXAMPLES) {
    it(`export as a plugin that type-checks: ${ex.title}`, () => {
      expect(check(snippetToPlugin(ex.code, ex.title), true)).toEqual([]);
    });
  }

  it("catch a mistake, so the check above is not vacuous", () => {
    expect(check("api.document.nope();").join()).toMatch(/nope/);
  });
});
