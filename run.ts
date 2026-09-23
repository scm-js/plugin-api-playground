/**
 * Running a snippet. The compiled JavaScript becomes a module of its own (a `blob:` URL),
 * imported like any other, so top-level `await` and `import` from a full URL work as they
 * would in a plugin. What it has in scope comes in through one line put in front of it:
 *
 * - `api` is a child of the playground's own (`api.scope()`), so everything the snippet
 *   registers — menu items, listeners, panels, overlays, tools — goes with `stop()`, and
 *   anything left running after that finds the map's writes refused.
 * - `console`, and `api.log`, write to the playground's output as well as the browser's.
 * - `setTimeout`, `setInterval` and `requestAnimationFrame` are wrapped so `stop()` can
 *   clear what they left scheduled, which the scope cannot see.
 *
 * The line is put on the same line as the snippet's first, so line numbers need no shift.
 * Nothing here can stop a loop that never yields: the snippet runs on the page's own
 * thread, as a plugin does.
 */
import type { PluginApi, PluginScope } from "@scm-js/plugin-api";
import { lineTable, originalLine } from "./sourcemap";

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  args: unknown[];
  /** The snippet line, for an error that says where it was thrown. */
  line?: number | null;
  /** The playground's own words (ran in 12 ms, stopped), not the snippet's. */
  note?: boolean;
}

const HANDOFF = Symbol.for("scmjs.apiPlayground");

interface Handoff {
  api: PluginApi;
  console: Console;
  setTimeout: typeof setTimeout;
  setInterval: typeof setInterval;
  clearTimeout: typeof clearTimeout;
  clearInterval: typeof clearInterval;
  requestAnimationFrame: typeof requestAnimationFrame;
  cancelAnimationFrame: typeof cancelAnimationFrame;
}

type Registry = { take(id: string): Handoff | undefined; runs: Map<string, Handoff> };

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  let r = g[HANDOFF];
  if (!r) {
    const runs = new Map<string, Handoff>();
    r = { runs, take(id) { const h = runs.get(id); runs.delete(id); return h; } };
    g[HANDOFF] = r;
  }
  return r;
}

const NAMES = ["api", "console", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] as const;

/** The line put in front of the snippet. */
export function prelude(id: string): string {
  return `const { ${NAMES.join(", ")} } = globalThis[Symbol.for("scmjs.apiPlayground")].take(${JSON.stringify(id)}); `;
}

/** The module text: the prelude, the snippet, and its source map inline so the browser's debugger shows the TypeScript. */
export function moduleText(id: string, js: string, map: string | null): string {
  const body = js.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");
  const inline = map ? `//# sourceMappingURL=data:application/json;base64,${btoa(unescape(encodeURIComponent(map)))}\n` : "";
  return `${prelude(id)}${body}${inline}`;
}

/** The first `url:line:col` in a stack that belongs to `url`, as the line. */
export function stackLine(stack: string | undefined, url: string): number | null {
  if (!stack) return null;
  const at = stack.indexOf(url);
  if (at < 0) return null;
  const m = /^:(\d+):\d+/.exec(stack.slice(at + url.length));
  return m ? Number(m[1]) : null;
}

export type RunState = "idle" | "running" | "live" | "failed";

export interface RunReport {
  ok: boolean;
  ms: number;
  error?: unknown;
  line?: number | null;
  /** Undo entries the run added while its top level ran. */
  edits: number;
}

export interface RunnerHooks {
  log(entry: LogEntry): void;
  state(state: RunState): void;
}

export class Runner {
  private scope: PluginScope | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private intervals = new Set<ReturnType<typeof setInterval>>();
  private frames = new Set<number>();
  private url: string | null = null;
  private table: number[] = [];
  private detach: (() => void) | null = null;
  private seq = 0;
  /** The history as the run left it, for `undoRun`. */
  private after: { label: string | null; depth: number; edits: number } | null = null;
  state: RunState = "idle";

  private readonly api: PluginApi;
  private readonly hooks: RunnerHooks;

  constructor(api: PluginApi, hooks: RunnerHooks) {
    this.api = api;
    this.hooks = hooks;
  }

  private set(state: RunState) {
    this.state = state;
    this.hooks.state(state);
  }

  /** Whether a run's registrations are still in place. */
  live(): boolean {
    return this.scope !== null && !this.scope.disposed;
  }

  /** Take back everything the last run registered and clear what it scheduled. */
  stop() {
    for (const t of this.timers) clearTimeout(t);
    for (const t of this.intervals) clearInterval(t);
    for (const f of this.frames) cancelAnimationFrame(f);
    this.timers.clear();
    this.intervals.clear();
    this.frames.clear();
    this.scope?.dispose();
    this.scope = null;
    this.detach?.();
    this.detach = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (this.state === "live" || this.state === "running") this.set("idle");
  }

  /** The snippet line an error came from, when its stack reaches the snippet. */
  lineOf(err: unknown): number | null {
    if (!this.url) return null;
    const line = stackLine((err as { stack?: string } | null)?.stack, this.url);
    return line === null ? null : originalLine(this.table, line);
  }

  /** How many of the run's edits `undoRun` can still take back: none once anything else has been done to the map. */
  undoable(): number {
    const a = this.after;
    if (!a || a.edits <= 0) return 0;
    const h = this.api.document.history();
    return h.undoDepth === a.depth && h.undo === a.label ? a.edits : 0;
  }

  undoRun(): number {
    const n = this.undoable();
    for (let i = 0; i < n; i++) this.api.document.undo();
    this.after = null;
    return n;
  }

  async run(js: string, map: string | null): Promise<RunReport> {
    this.stop();
    this.after = null;
    const id = `run-${Date.now().toString(36)}-${++this.seq}`;
    const scope = this.api.scope();
    this.scope = scope;
    this.table = map ? lineTable((JSON.parse(map) as { mappings: string }).mappings) : [];
    const handoff = this.handoff(scope);
    registry().runs.set(id, handoff);
    const url = URL.createObjectURL(new Blob([moduleText(id, js, map)], { type: "text/javascript" }));
    this.url = url;
    this.detach = this.watchUncaught(url);

    const before = this.api.document.history().undoDepth;
    const started = performance.now();
    this.set("running");
    try {
      await import(/* @vite-ignore */ url);
      const h = this.api.document.history();
      this.after = { label: h.undo, depth: h.undoDepth, edits: Math.max(0, h.undoDepth - before) };
      // A newer run may have started while this one awaited.
      if (this.scope === scope) this.set("live");
      return { ok: true, ms: Math.round(performance.now() - started), edits: this.after.edits };
    } catch (error) {
      registry().runs.delete(id);
      const h = this.api.document.history();
      this.after = { label: h.undo, depth: h.undoDepth, edits: Math.max(0, h.undoDepth - before) };
      const line = this.lineOf(error);
      if (this.scope === scope) this.set("failed");
      return { ok: false, ms: Math.round(performance.now() - started), error, line, edits: this.after.edits };
    }
  }

  /** Errors thrown later from the snippet's own code — a timer, a click handler — reach the output too. */
  private watchUncaught(url: string): () => void {
    const onError = (e: ErrorEvent) => {
      if (!e.filename?.startsWith(url) && stackLine((e.error as Error | undefined)?.stack, url) === null) return;
      const line = e.lineno ? originalLine(this.table, e.lineno) : this.lineOf(e.error);
      this.hooks.log({ level: "error", args: [e.error ?? e.message], line });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (stackLine((e.reason as Error | undefined)?.stack, url) === null) return;
      this.hooks.log({ level: "error", args: ["Unhandled rejection:", e.reason], line: this.lineOf(e.reason) });
    };
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
    return () => {
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
    };
  }

  private handoff(scope: PluginScope): Handoff {
    const hooks = this.hooks;
    const out = (level: LogLevel) => (...args: unknown[]) => {
      (console[level] as (...a: unknown[]) => void)(...args);
      hooks.log({ level, args, line: level === "error" && args[0] instanceof Error ? this.lineOf(args[0]) : undefined });
    };
    const snippetConsole = Object.assign(Object.create(console) as Console, {
      log: out("log"), info: out("info"), warn: out("warn"), error: out("error"), debug: out("debug"),
    });
    // The snippet's `api` is the scope's, with `log` also writing to the output; spread, since the host's object is plain data.
    const scoped = scope.api;
    const api = { ...scoped, log: (...args: unknown[]) => { scoped.log(...args); hooks.log({ level: "log", args }); } } as PluginApi;
    const timers = this.timers, intervals = this.intervals, frames = this.frames;
    return {
      api,
      console: snippetConsole,
      setTimeout: ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
        const t: ReturnType<typeof setTimeout> = setTimeout((...a: unknown[]) => { timers.delete(t); if (typeof fn === "function") fn(...a); }, ms, ...rest);
        timers.add(t);
        return t;
      }) as typeof setTimeout,
      clearTimeout: (t) => { if (t !== undefined) timers.delete(t as ReturnType<typeof setTimeout>); clearTimeout(t); },
      setInterval: ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
        const t = setInterval(fn, ms, ...rest);
        intervals.add(t);
        return t;
      }) as typeof setInterval,
      clearInterval: (t) => { if (t !== undefined) intervals.delete(t as ReturnType<typeof setInterval>); clearInterval(t); },
      requestAnimationFrame: (cb) => {
        const f = requestAnimationFrame((time) => { frames.delete(f); cb(time); });
        frames.add(f);
        return f;
      },
      cancelAnimationFrame: (f) => { frames.delete(f); cancelAnimationFrame(f); },
    };
  }
}
