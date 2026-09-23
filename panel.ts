/**
 * The playground's panel: a toolbar, the snippet in Monaco, and the output under it.
 *
 * The runner and the output outlive the panel. Closing it leaves a run's menu items and
 * listeners in place, which is often the point (a snippet that adds a panel of its own);
 * reopening shows the same output with Stop still able to take them back.
 */
import type * as Monaco from "monaco-editor";
import type { PanelHandle, PluginApi } from "@scm-js/plugin-api";
import { EXAMPLES, FIRST } from "./examples";
import { detail, expandable, preview } from "./inspect";
import { Library, type Draft } from "./library";
import { MAX_LINK_CHARS, snippetLink } from "./link";
import { compile, DEFAULT_DIST, DIST_STORAGE_KEY, loadMonaco, releaseWorker, SNIPPET_URI, THEME, type MonacoApi } from "./monaco";
import { Runner, type LogEntry, type RunState } from "./run";
import { idFromName, starterFiles } from "./starter";
import { TYPES_VERSION } from "./types";
import { zip } from "./zip";

type T = (text: string, params?: Record<string, string | number>) => string;

const REFERENCE_URL = "https://docs.scmjs.dev/api/";
const MAX_LINES = 500;
const MARKER_OWNER = "playground-run";

const STYLE = `
.apg { display: flex; flex-direction: column; flex: 1; min-height: 0; font-size: var(--fs-md); }
.apg-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); background: var(--bg-2); }
.apg-bar .select { max-width: 170px; }
.apg-bar .apg-gap { flex: 1; }
.apg-editor { flex: 1 1 60%; min-height: 120px; position: relative; background: var(--bg-0); }
.apg-editor .apg-wait { padding: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.apg-out-head { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--bg-2); }
.apg-out-head .apg-state { flex: 1; color: var(--text-dim); font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.apg-out-head .apg-state.failed { color: var(--danger); }
.apg-out-head .apg-state.live { color: var(--teal); }
.apg-out { flex: 0 0 34%; min-height: 60px; overflow: auto; background: var(--bg-0); font-family: var(--font-mono); font-size: var(--fs-sm); padding: 4px 0; }
.apg-out .apg-empty { color: var(--text-faint); padding: 4px 10px; font-family: var(--font-ui); }
.apg-line { padding: 1px 10px; white-space: pre-wrap; word-break: break-word; border-left: 2px solid transparent; }
.apg-line + .apg-line { border-top: 1px solid var(--bg-2); }
.apg-line.warn { color: var(--warn); border-left-color: var(--warn); background: rgba(224, 165, 69, 0.06); }
.apg-line.error { color: var(--danger); border-left-color: var(--danger); background: rgba(217, 83, 79, 0.07); }
.apg-line.note { color: var(--text-faint); font-family: var(--font-ui); }
.apg-line details { display: inline-block; vertical-align: top; }
.apg-line summary { cursor: pointer; }
.apg-line details[open] > summary { color: var(--text-dim); }
.apg-line pre { margin: 2px 0 2px 14px; font: inherit; color: var(--text); }
.apg-line .apg-at { color: var(--teal); cursor: pointer; margin-left: 8px; text-decoration: underline dotted; }
.apg-foot { padding: 3px 8px; color: var(--text-faint); font-size: var(--fs-xs); border-top: 1px solid var(--border); background: var(--bg-2); display: flex; gap: 8px; }
.apg-foot a { color: var(--text-dim); }
`;

interface Mounted {
  monaco: MonacoApi | null;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  model: Monaco.editor.ITextModel | null;
  out: HTMLElement;
  state: HTMLElement;
  picker: HTMLSelectElement;
  run: HTMLButtonElement;
  stop: HTMLButtonElement;
  undo: HTMLButtonElement;
  remove: HTMLButtonElement;
  panel: PanelHandle;
}

export class Playground {
  private readonly api: PluginApi;
  private readonly t: T;
  private readonly library: Library;
  private readonly runner: Runner;
  private readonly lines: LogEntry[] = [];
  private draft: Draft;
  private ui: Mounted | null = null;
  private handle: PanelHandle | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private compiling = false;

  constructor(api: PluginApi, t: T) {
    this.api = api;
    this.t = t;
    this.library = new Library(api.storage);
    this.draft = this.library.draft() ?? { code: FIRST.code, source: `example:${FIRST.id}` };
    this.runner = new Runner(api, {
      log: (entry) => this.log(entry),
      state: () => this.refresh(),
    });
    // The run's edits can be undone only while nothing else has been done to the map.
    api.events.on("commit", () => this.refresh());
    api.events.on("document", () => this.refresh());
  }

  isOpen(): boolean {
    return this.handle?.isOpen() ?? false;
  }

  toggle() {
    if (this.isOpen()) this.handle?.close();
    else this.open();
  }

  open() {
    if (this.isOpen()) return;
    const t = this.t;
    this.handle = this.api.ui.panel({
      title: t("API Playground"),
      width: 720,
      height: 560,
      resizable: true,
      flush: true,
      mount: (body, panel) => this.mount(body, panel),
      onClose: () => { this.handle = null; },
    });
  }

  /** The plugin is being turned off. */
  dispose() {
    this.flushDraft();
    this.runner.stop();
    this.handle?.close();
  }

  /* ── The panel ─────────────────────────────────────────── */

  private mount(body: HTMLElement, panel: PanelHandle): () => void {
    const { api, t } = this;
    const w = api.ui.widgets;
    const el = api.ui.el;

    const picker = el("select", { className: "select", title: t("Open an example or a saved snippet") });
    picker.addEventListener("change", () => void this.pick(picker.value));
    const run = w.button(t("Run"), { primary: true, className: "sm", title: t("Run the snippet (Ctrl+Enter)"), onClick: () => void this.run() });
    const stop = w.button(t("Stop"), { className: "sm", title: t("Take back everything the last run registered"), onClick: () => this.stop() });
    const undo = w.button(t("Undo Run"), { className: "sm", title: t("Undo the map edits the last run made"), onClick: () => this.undoRun() });
    const save = w.button(t("Save"), { className: "sm", title: t("Save the snippet (Ctrl+S)"), onClick: () => void this.save(false) });
    const saveAs = w.button(t("Save As…"), { className: "sm", onClick: () => void this.save(true) });
    const remove = w.button(t("Delete…"), { className: "sm", onClick: () => void this.remove() });
    const exportBtn = w.button(t("Export as Plugin…"), { className: "sm", title: t("Download the snippet as the files of a new plugin"), onClick: () => this.exportPlugin() });

    const editorHost = el("div", { className: "apg-editor" });
    const state = el("span", { className: "apg-state" });
    const clear = w.button(t("Clear"), { className: "sm", ghost: true, onClick: () => { this.lines.length = 0; this.renderOutput(); } });
    const out = el("div", { className: "apg-out", role: "log" });
    const reference = el("a", { href: REFERENCE_URL, target: "_blank", rel: "noopener" }, t("API reference"));
    const copyLink = el("a", { href: "#", title: t("Copy a link that opens this snippet in the playground") }, t("Copy Link"));
    copyLink.addEventListener("click", (e) => { e.preventDefault(); void this.copyLink(); });
    const foot = el("div", { className: "apg-foot" },
      el("span", {}, t("Types from @scm-js/plugin-api {version}", { version: TYPES_VERSION })),
      el("span", { className: "apg-gap", style: "flex:1" }),
      copyLink,
      reference);

    const root = el("div", { className: "apg" },
      el("style", {}, STYLE),
      el("div", { className: "apg-bar" }, picker, run, stop, undo, el("span", { className: "apg-gap" }), save, saveAs, remove, exportBtn),
      editorHost,
      el("div", { className: "apg-out-head" }, el("strong", {}, t("Output")), state, clear),
      out,
      foot);
    body.append(root);

    const ui: Mounted = { monaco: null, editor: null, model: null, out, state, picker, run, stop, undo, remove, panel };
    this.ui = ui;
    this.fillPicker();
    this.renderOutput();
    this.refresh();
    void this.startEditor(ui, editorHost);

    return () => {
      this.flushDraft();
      ui.editor?.dispose();
      ui.model?.dispose();
      if (ui.monaco) releaseWorker(ui.monaco);
      if (this.ui === ui) this.ui = null;
    };
  }

  private async startEditor(ui: Mounted, host: HTMLElement) {
    const { api, t } = this;
    const w = api.ui.widgets;
    host.replaceChildren(api.ui.el("div", { className: "apg-wait" }, w.spinner({ label: t("Loading the code editor…") })));
    let monaco: MonacoApi;
    try {
      monaco = await loadMonaco(api.storage.get<string>(DIST_STORAGE_KEY, DEFAULT_DIST));
    } catch (err) {
      if (this.ui !== ui) return;
      host.replaceChildren(api.ui.el("div", { className: "apg-wait" },
        w.hint(t("The code editor could not be loaded: {error}", { error: err instanceof Error ? err.message : String(err) })),
        w.button(t("Try Again"), { className: "sm", onClick: () => void this.startEditor(ui, host) })));
      return;
    }
    if (this.ui !== ui) return;
    host.replaceChildren();
    // One snippet at a time; a model left from an earlier opening is replaced.
    monaco.editor.getModel(monaco.Uri.parse(SNIPPET_URI))?.dispose();
    const model = monaco.editor.createModel(this.draft.code, "typescript", monaco.Uri.parse(SNIPPET_URI));
    const editor = monaco.editor.create(host, {
      model,
      theme: THEME,
      automaticLayout: true,
      fontFamily: '"Cascadia Mono", "JetBrains Mono", ui-monospace, Consolas, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 18,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 },
      quickSuggestions: { other: true, strings: false, comments: false },
      suggest: { showWords: false },
      // Map text is full of characters Monaco would box as look-alikes (×, Hangul, the game's colour codes).
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void this.run());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void this.save(false));
    model.onDidChangeContent(() => {
      this.draft = { ...this.draft, code: model.getValue() };
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      this.scheduleDraft();
      this.refreshTitle();
    });
    ui.monaco = monaco;
    ui.editor = editor;
    ui.model = model;
    this.refresh();
    editor.focus();
  }

  /* ── Snippets ──────────────────────────────────────────── */

  private sourceCode(source: string | null): string {
    if (source?.startsWith("example:")) return EXAMPLES.find((e) => `example:${e.id}` === source)?.code ?? "";
    if (source?.startsWith("saved:")) return this.library.get(source.slice(6))?.code ?? "";
    return "";
  }

  private sourceName(source: string | null): string | null {
    if (source?.startsWith("example:")) {
      const ex = EXAMPLES.find((e) => `example:${e.id}` === source);
      return ex ? this.t(ex.title) : null;
    }
    if (source?.startsWith("saved:")) return this.library.get(source.slice(6))?.name ?? null;
    return null;
  }

  private modified(): boolean {
    return this.draft.code.trim() !== this.sourceCode(this.draft.source).trim();
  }

  private fillPicker() {
    const ui = this.ui;
    if (!ui) return;
    const { t } = this;
    const el = this.api.ui.el;
    const saved = this.library.list();
    ui.picker.replaceChildren(
      el("option", { value: "new" }, t("New snippet")),
      el("optgroup", { label: t("Examples") }, ...EXAMPLES.map((e) => el("option", { value: `example:${e.id}` }, t(e.title)))),
      ...(saved.length ? [el("optgroup", { label: t("Saved") }, ...saved.map((s) => el("option", { value: `saved:${s.id}` }, s.name)))] : []),
    );
    ui.picker.value = this.draft.source && [...ui.picker.options].some((o) => o.value === this.draft.source) ? this.draft.source : "new";
    this.refreshTitle();
  }

  private refreshTitle() {
    const ui = this.ui;
    if (!ui) return;
    const name = this.sourceName(this.draft.source);
    const mark = this.modified() ? " •" : "";
    ui.panel.setTitle(name ? `${this.t("API Playground")} — ${name}${mark}` : `${this.t("API Playground")}${mark}`);
    ui.remove.disabled = !this.draft.source?.startsWith("saved:");
  }

  private async pick(value: string) {
    const ui = this.ui;
    if (!ui) return;
    const source = value === "new" ? null : value;
    if (source === this.draft.source && !this.modified()) return;
    if (this.modified() && this.draft.code.trim()) {
      const ok = await this.api.ui.confirm(this.t("The snippet in the editor has changes that are not saved. Replace it?"), {
        title: this.t("API Playground"), confirmLabel: this.t("Replace"), danger: true,
      });
      if (!ok) { this.fillPicker(); return; }
    }
    this.draft = { code: this.sourceCode(source), source };
    ui.model?.setValue(this.draft.code);
    this.flushDraft();
    this.fillPicker();
    ui.editor?.focus();
  }

  private async save(as: boolean) {
    const { t } = this;
    const current = this.draft.source?.startsWith("saved:") ? this.library.get(this.draft.source.slice(6)) : null;
    let name = current?.name ?? null;
    if (as || !current) {
      const suggested = current?.name ?? (this.draft.source?.startsWith("example:") ? this.sourceName(this.draft.source) : null) ?? "";
      name = await this.api.ui.prompt(t("A name for the snippet:"), { title: as ? t("Save As") : t("Save"), value: suggested, confirmLabel: t("Save") });
      if (name === null) return;
      name = name.trim() || t("Untitled");
    }
    const saved = this.library.save(name!, this.draft.code, as ? undefined : current?.id);
    if (!saved) {
      this.api.ui.toast({ kind: "error", title: t("The snippet could not be saved"), detail: t("The browser's storage for the editor is full.") });
      return;
    }
    this.draft = { code: this.draft.code, source: `saved:${saved.id}` };
    this.flushDraft();
    this.fillPicker();
    this.api.ui.status(t("Saved “{name}”.", { name: saved.name }));
  }

  private async remove() {
    const { t } = this;
    const current = this.draft.source?.startsWith("saved:") ? this.library.get(this.draft.source.slice(6)) : null;
    if (!current) return;
    const ok = await this.api.ui.confirm(t("Delete the saved snippet “{name}”? The editor keeps its text.", { name: current.name }), {
      title: t("Delete Snippet"), confirmLabel: t("Delete"), danger: true,
    });
    if (!ok) return;
    this.library.remove(current.id);
    this.draft = { code: this.draft.code, source: null };
    this.flushDraft();
    this.fillPicker();
  }

  private scheduleDraft() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushDraft(), 400);
  }

  private flushDraft() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.library.setDraft(this.draft);
  }

  /**
   * A snippet that came in a link: into the editor as a new, unsaved snippet, never run.
   * Changes in the editor that are not saved are only replaced if the user says so.
   */
  async openLinked(code: string) {
    const { t } = this;
    if (this.draft.code !== code && this.modified() && this.draft.code.trim()) {
      const ok = await this.api.ui.confirm(t("A link opened a snippet in the API Playground. Replace the snippet in the editor? Its changes are not saved."), {
        title: t("API Playground"), confirmLabel: t("Replace"), danger: true,
      });
      if (!ok) return;
    }
    this.draft = { code, source: null };
    this.flushDraft();
    this.ui?.model?.setValue(code);
    this.fillPicker();
    this.open();
    this.log({ level: "warn", args: [t("This snippet came from a link. Read it before you run it: a snippet can do anything the editor can.")] });
  }

  private async copyLink() {
    const { api, t } = this;
    const link = await snippetLink(this.draft.code);
    if (link.length > MAX_LINK_CHARS) {
      api.ui.toast({ kind: "warn", title: t("The snippet is too long for a link"), detail: t("Save it, or use Export as Plugin to share it as files.") });
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      api.ui.status(t("Link copied. It opens this snippet in the playground of whoever follows it; nothing runs until they press Run."));
    } catch {
      // No clipboard permission: the link in a field the user can copy from.
      await api.ui.prompt(t("The link to this snippet:"), { title: t("Copy Link"), value: link, confirmLabel: t("Close") });
    }
  }

  /* ── Running ───────────────────────────────────────────── */

  private async run() {
    const ui = this.ui;
    if (!ui?.monaco || !ui.model || this.compiling || this.runner.state === "running") return;
    const { t } = this;
    const { monaco, model } = ui;
    this.flushDraft();
    monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    this.compiling = true;
    this.refresh();
    let compiled;
    try {
      compiled = await compile(monaco, model);
    } catch (err) {
      this.log({ level: "error", args: [t("The snippet could not be compiled:"), err] });
      return;
    } finally {
      this.compiling = false;
      this.refresh();
    }
    const syntax = compiled.diagnostics.filter((d) => d.syntax);
    if (syntax.length) {
      for (const d of syntax) this.log({ level: "error", args: [d.message], line: d.line });
      this.log({ level: "info", args: [t("Not run: fix the syntax error first.")], note: true });
      return;
    }
    const types = compiled.diagnostics.filter((d) => !d.syntax);
    if (types.length) {
      this.log({
        level: "warn",
        args: [types.length === 1 ? t("1 type error; running anyway: {message}", { message: types[0].message }) : t("{count} type errors; running anyway. The first: {message}", { count: types.length, message: types[0].message })],
        line: types[0].line,
      });
    }
    const report = await this.runner.run(compiled.js, compiled.map);
    if (report.ok) {
      const text = report.edits ? t("Ran in {ms} ms. Undo steps added: {count}.", { ms: report.ms, count: report.edits }) : t("Ran in {ms} ms.", { ms: report.ms });
      this.log({ level: "info", args: [text], note: true });
    } else {
      this.log({ level: "error", args: [report.error], line: report.line });
      if (report.line && this.ui?.model === model) {
        monaco.editor.setModelMarkers(model, MARKER_OWNER, [{
          severity: monaco.MarkerSeverity.Error,
          message: report.error instanceof Error ? report.error.message : String(report.error),
          startLineNumber: report.line, startColumn: model.getLineFirstNonWhitespaceColumn(report.line) || 1,
          endLineNumber: report.line, endColumn: model.getLineMaxColumn(report.line),
        }]);
      }
    }
    this.refresh();
  }

  private stop() {
    this.runner.stop();
    this.log({ level: "info", args: [this.t("Stopped: everything the last run registered has been taken back.")], note: true });
  }

  private undoRun() {
    const n = this.runner.undoRun();
    if (n) this.log({ level: "info", args: [this.t("Undid the last run's map edits. Undo steps taken back: {count}.", { count: n })], note: true });
    this.refresh();
  }

  private refresh() {
    const ui = this.ui;
    if (!ui) return;
    const { t } = this;
    const state: RunState = this.runner.state;
    const busy = this.compiling || state === "running";
    ui.run.disabled = !ui.monaco || busy;
    ui.stop.disabled = !this.runner.live();
    const undoable = this.runner.undoable();
    ui.undo.disabled = undoable === 0;
    ui.undo.title = undoable ? t("Undo the map edits the last run made (undo steps: {count})", { count: undoable }) : t("Undo the map edits the last run made");
    ui.state.className = `apg-state ${state}`;
    ui.state.textContent = this.compiling ? t("Compiling…")
      : state === "running" ? t("Running…")
      : state === "live" ? t("What the run registered stays until Stop or the next run.")
      : state === "failed" ? t("The run failed. What it registered before the error stays until Stop.")
      : t("Ctrl+Enter runs the snippet.");
    this.refreshTitle();
  }

  /* ── Output ────────────────────────────────────────────── */

  private log(entry: LogEntry) {
    this.lines.push(entry);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    const ui = this.ui;
    if (!ui) return;
    const empty = ui.out.querySelector(".apg-empty");
    if (empty) empty.remove();
    while (ui.out.childElementCount >= MAX_LINES) ui.out.firstElementChild?.remove();
    const stick = ui.out.scrollTop + ui.out.clientHeight >= ui.out.scrollHeight - 4;
    ui.out.append(this.renderLine(entry));
    if (stick) ui.out.scrollTop = ui.out.scrollHeight;
  }

  private renderOutput() {
    const ui = this.ui;
    if (!ui) return;
    ui.out.replaceChildren(...this.lines.map((l) => this.renderLine(l)));
    if (!this.lines.length) ui.out.append(this.api.ui.el("div", { className: "apg-empty" }, this.t("What the snippet logs with console.log appears here.")));
    ui.out.scrollTop = ui.out.scrollHeight;
  }

  private renderLine(entry: LogEntry): HTMLElement {
    const el = this.api.ui.el;
    const kind = entry.note ? "note" : entry.level === "warn" ? "warn" : entry.level === "error" ? "error" : "";
    const parts: (Node | string)[] = [];
    entry.args.forEach((arg, i) => {
      if (i > 0) parts.push(" ");
      if (typeof arg === "string") parts.push(arg);
      else if (arg instanceof Error) parts.push(`${arg.name}: ${arg.message}`);
      else if (expandable(arg)) parts.push(el("details", {}, el("summary", {}, preview(arg)), el("pre", {}, detail(arg))));
      else parts.push(preview(arg));
    });
    if (entry.line) {
      const line = entry.line;
      const at = el("span", { className: "apg-at", title: this.t("Show the line") }, this.t("line {line}", { line }));
      at.addEventListener("click", () => this.reveal(line));
      parts.push(at);
    }
    return el("div", { className: `apg-line ${kind}` }, ...parts);
  }

  private reveal(line: number) {
    const editor = this.ui?.editor;
    if (!editor) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  }

  /* ── Export ────────────────────────────────────────────── */

  private exportPlugin() {
    const { api, t } = this;
    const w = api.ui.widgets;
    const snippetName = this.sourceName(this.draft.source);
    const name = w.text({ value: snippetName && this.draft.source?.startsWith("saved:") ? snippetName : "My Plugin" });
    const id = w.text({ value: idFromName(name.value) });
    let idEdited = false;
    id.addEventListener("input", () => { idEdited = true; });
    name.addEventListener("input", () => { if (!idEdited) id.value = idFromName(name.value); });
    const description = w.text({ value: "" });
    const author = w.text({ value: "" });
    const code = this.draft.code;
    api.ui.dialog({
      title: t("Export as Plugin"),
      size: "md",
      mount(body) {
        body.append(
          w.hint(t("The snippet becomes the body of the plugin's activate(api) function. You get a zip with plugin.json, plugin.ts, and the package.json and tsconfig.json to type-check and build it. Its README says how to load it into the editor from your computer.")),
          w.form([
            { label: t("Name"), field: name },
            { label: t("Id"), field: id },
            { label: t("Description"), field: description },
            { label: t("Author"), field: author },
          ]),
        );
        name.focus();
        name.select();
      },
      buttons: [
        { label: t("Cancel") },
        {
          label: t("Export"),
          primary: true,
          run: async () => {
            const pluginName = name.value.trim() || "My Plugin";
            const pluginId = idFromName(id.value.trim() || pluginName);
            const files = starterFiles({ name: pluginName, id: pluginId, description: description.value.trim(), author: author.value.trim(), code, typesVersion: TYPES_VERSION });
            const bytes = zip(Object.fromEntries(Object.entries(files).map(([p, text]) => [`${pluginId}/${p}`, text])));
            const saved = await api.ui.saveFile(bytes, `${pluginId}.zip`);
            if (!saved) return false;
            api.ui.status(t("Saved {file}.", { file: saved.fileName }));
            return true;
          },
        },
      ],
    });
  }
}
