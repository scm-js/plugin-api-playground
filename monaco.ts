/**
 * Monaco, borrowed from TrigScript: the same self-built bundle (the editor with the
 * TypeScript language, and its two workers) that plugin serves from a tag of its
 * repository through jsDelivr. Why a self-built bundle rather than a CDN's is in
 * TrigScript's `bundle/build.mjs`.
 *
 * The playground imports it under its own URL (`?instance=playground`), which makes it a
 * module instance of its own. With TrigScript's editor open at the same time, the two would
 * otherwise share one TypeScript language service: TrigScript replaces the extra libraries
 * whenever the map's names change and resets the compiler options when its editor closes,
 * and each would see the other's files. The cost is a second download of the same bundle,
 * only when both are in use. The theme is TrigScript's, rule for rule: Monaco writes token
 * colours into global `.mtkN` classes, so two instances with different themes would repaint
 * each other.
 *
 * The URL is not a static import on purpose: the editor's plugin loader follows every
 * literal import specifier. A dynamic `import()` of a variable passes through untouched.
 */
import type * as Monaco from "monaco-editor";
import { extraLibs } from "./types";

export const DIST_TAG = "monaco-0.56.0-2";
export const DEFAULT_DIST = `https://cdn.jsdelivr.net/gh/scm-js/plugin-trigscript@${DIST_TAG}/dist`;
/** The plugin storage key that overrides where the bundle is fetched from (development: a local server). */
export const DIST_STORAGE_KEY = "monacoDist";

export type MonacoApi = typeof Monaco;
type TsLanguage = typeof Monaco.typescript;

export const THEME = "scm";
/** The snippet's one model. `file:///` so module resolution finds the typings under `file:///node_modules`. */
export const SNIPPET_URI = "file:///snippet.ts";

let loading: Promise<MonacoApi> | null = null;

function moduleWorker(url: string): Worker {
  const blob = new Blob([`import ${JSON.stringify(url)};\n`], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob), { type: "module" });
}

export function tsLanguage(monaco: MonacoApi): TsLanguage {
  const found = monaco.typescript ?? (monaco.languages as unknown as { typescript?: TsLanguage }).typescript;
  if (!found?.typescriptDefaults) throw new Error("Monaco loaded without its TypeScript language service.");
  return found;
}

/** TypeScript's `ModuleResolutionKind.Bundler` and `ModuleDetectionKind.Force`; Monaco's copies of the enums predate them. */
const BUNDLER_RESOLUTION = 100;
const MODULE_DETECTION_FORCE = 3;

function configure(monaco: MonacoApi) {
  const ts = tsLanguage(monaco);
  ts.typescriptDefaults.setCompilerOptions({
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: BUNDLER_RESOLUTION as unknown as Monaco.typescript.ModuleResolutionKind,
    // Every file is a module, so a snippet can `await` at the top and its names do not collide with the page's.
    moduleDetection: MODULE_DETECTION_FORCE,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    // Emitted by `compile` below; a snippet with a type error still runs, as in the TypeScript playground.
    noEmit: false,
    sourceMap: true,
    inlineSources: true,
    allowNonTsExtensions: true,
  });
  ts.typescriptDefaults.setEagerModelSync(true);
  ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  ts.typescriptDefaults.setExtraLibs(extraLibs());

  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5d6675", fontStyle: "italic" },
      { token: "keyword", foreground: "e6b95c" },
      { token: "string", foreground: "4fd1c5" },
      { token: "number", foreground: "f4d08a" },
      { token: "type.identifier", foreground: "8fd3ff" },
      { token: "identifier", foreground: "dde2ea" },
      { token: "delimiter", foreground: "99a2b3" },
      { token: "operator", foreground: "99a2b3" },
    ],
    colors: {
      "editor.background": "#0a0c10",
      "editor.foreground": "#dde2ea",
      "editor.lineHighlightBackground": "#12151b",
      "editor.lineHighlightBorder": "#12151b",
      "editorLineNumber.foreground": "#5d6675",
      "editorLineNumber.activeForeground": "#99a2b3",
      "editor.selectionBackground": "#2b4f80",
      "editor.inactiveSelectionBackground": "#222732",
      "editorCursor.foreground": "#e6b95c",
      "editorIndentGuide.background1": "#222732",
      "editorIndentGuide.activeBackground1": "#353c4b",
      "editorWidget.background": "#191d25",
      "editorWidget.border": "#2c3341",
      "editorSuggestWidget.background": "#191d25",
      "editorSuggestWidget.border": "#2c3341",
      "editorSuggestWidget.selectedBackground": "#2b4f80",
      "editorHoverWidget.background": "#191d25",
      "editorHoverWidget.border": "#2c3341",
      "editorError.foreground": "#d9534f",
      "editorWarning.foreground": "#e0a545",
      "scrollbarSlider.background": "#353c4b80",
      "scrollbarSlider.hoverBackground": "#3b4453a0",
      "editorGutter.background": "#0a0c10",
      "minimap.background": "#0a0c10",
      "focusBorder": "#3a68a8",
      "widget.shadow": "#000000a0",
      "input.background": "#0a0c10",
      "input.foreground": "#dde2ea",
      "input.border": "#2c3341",
      "quickInput.background": "#191d25",
      "quickInput.foreground": "#dde2ea",
      "quickInputList.focusBackground": "#2b4f80",
      "quickInputList.focusForeground": "#dde2ea",
      "list.hoverBackground": "#222732",
      "list.highlightForeground": "#e6b95c",
      "list.focusHighlightForeground": "#f4d08a",
      "pickerGroup.border": "#2c3341",
      "pickerGroup.foreground": "#99a2b3",
      "keybindingLabel.background": "#222732",
      "keybindingLabel.foreground": "#dde2ea",
      "keybindingLabel.border": "#3b4453",
      "keybindingLabel.bottomBorder": "#3b4453",
      "menu.background": "#191d25",
      "menu.foreground": "#dde2ea",
      "menu.selectionBackground": "#2b4f80",
      "menu.selectionForeground": "#dde2ea",
      "menu.separatorBackground": "#2c3341",
      "menu.border": "#3b4453",
    },
  });
}

/** Monaco, loaded once from `base`; a failed load can be retried. */
export function loadMonaco(base: string = DEFAULT_DIST): Promise<MonacoApi> {
  loading ??= (async () => {
    const dist = base.replace(/\/+$/, "");
    // Global, and TrigScript sets it too; both point at the same two worker files.
    (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
      getWorker: (_id: string, label: string) => moduleWorker(`${dist}/${label === "typescript" || label === "javascript" ? "ts.worker.js" : "editor.worker.js"}`),
    };
    const monaco = (await import(/* @vite-ignore */ `${dist}/monaco.js?instance=playground`)) as MonacoApi;
    configure(monaco);
    return monaco;
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

export interface Diagnostic {
  line: number;
  column: number;
  message: string;
  /** A syntax error stops the run; a type error does not. */
  syntax: boolean;
}

export interface Compiled {
  js: string;
  /** The emitted source map, JSON. */
  map: string | null;
  diagnostics: Diagnostic[];
}

function flatten(text: string | { messageText: string; next?: unknown[] }): string {
  if (typeof text === "string") return text;
  const next = (text.next ?? []) as { messageText: string; next?: unknown[] }[];
  return [text.messageText, ...next.map(flatten)].join(" ");
}

/** The snippet as JavaScript, from Monaco's own TypeScript worker, with its diagnostics. */
export async function compile(monaco: MonacoApi, model: Monaco.editor.ITextModel): Promise<Compiled> {
  const worker = await (await tsLanguage(monaco).getTypeScriptWorker())(model.uri);
  const uri = model.uri.toString();
  const [syntactic, semantic, emitted] = await Promise.all([
    worker.getSyntacticDiagnostics(uri),
    worker.getSemanticDiagnostics(uri),
    worker.getEmitOutput(uri),
  ]);
  const diag = (d: Monaco.typescript.Diagnostic, syntax: boolean): Diagnostic => {
    const at = model.getPositionAt(d.start ?? 0);
    return { line: at.lineNumber, column: at.column, message: flatten(d.messageText as never), syntax };
  };
  const files = (emitted as { outputFiles: { name: string; text: string }[] }).outputFiles ?? [];
  return {
    js: files.find((f) => f.name.endsWith(".js"))?.text ?? "",
    map: files.find((f) => f.name.endsWith(".js.map"))?.text ?? null,
    diagnostics: [...syntactic.map((d) => diag(d, true)), ...semantic.map((d) => diag(d, false))],
  };
}

/** Stop Monaco's TypeScript worker, which Monaco never idles out by itself; it starts again with the next editor. */
export function releaseWorker(monaco: MonacoApi) {
  const defaults = tsLanguage(monaco).typescriptDefaults;
  defaults.setCompilerOptions(defaults.getCompilerOptions());
}
