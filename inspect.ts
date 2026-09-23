/**
 * How a value logged from a snippet reads in the output: `preview` is one line, `detail`
 * the same value laid out over several, for the fold under it. Both stop at a depth and a
 * length, since a snippet will happily log `api.document.scenario()` — the whole map.
 */

const MAX_ITEMS = 50;
const MAX_STRING = 400;

const isElement = (v: object): v is Element => typeof Element !== "undefined" && v instanceof Element;

function tagOf(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
  return `<${el.tagName.toLowerCase()}${id}${cls}>`;
}

function typedName(v: object): string | null {
  if (!ArrayBuffer.isView(v)) return null;
  return v.constructor?.name ?? "TypedArray";
}

function className(v: object): string {
  const name = Object.getPrototypeOf(v)?.constructor?.name;
  return name && name !== "Object" ? `${name} ` : "";
}

function str(s: string, quoted: boolean): string {
  const cut = s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}… (${s.length} characters)` : s;
  return quoted ? JSON.stringify(cut) : cut;
}

/** A value on one line, at most `width` characters where that can be kept to. */
export function preview(value: unknown, width = 120): string {
  const out = render(value, 0, 2, new WeakSet(), false, "");
  return out.length > width ? `${out.slice(0, width - 1)}…` : out;
}

/** A value laid out over lines, two spaces an indent, `depth` levels down. */
export function detail(value: unknown, depth = 4): string {
  return render(value, 0, depth, new WeakSet(), true, "");
}

/** Whether a value has an inside worth folding out. */
export function expandable(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (isElement(value) || value instanceof Date || value instanceof RegExp || value instanceof Error) return false;
  return true;
}

function render(value: unknown, level: number, depth: number, seen: WeakSet<object>, multi: boolean, indent: string): string {
  switch (typeof value) {
    case "string": return level === 0 && !multi ? str(value, false) : str(value, true);
    case "number": return Object.is(value, -0) ? "-0" : String(value);
    case "bigint": return `${value}n`;
    case "boolean": return String(value);
    case "undefined": return "undefined";
    case "symbol": return value.toString();
    case "function": return `ƒ ${value.name || "anonymous"}()`;
  }
  if (value === null) return "null";
  const obj = value as object;
  if (isElement(obj)) return tagOf(obj);
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? "Invalid Date" : obj.toISOString();
  if (obj instanceof RegExp) return String(obj);
  if (obj instanceof Error) return `${obj.name}: ${obj.message}`;
  if (obj instanceof Promise) return "Promise { … }";
  if (seen.has(obj)) return "[circular]";
  if (level >= depth) {
    if (Array.isArray(obj)) return `Array(${obj.length})`;
    const t = typedName(obj);
    if (t) return `${t}(${(obj as unknown as ArrayLike<number>).length})`;
    if (obj instanceof Map) return `Map(${obj.size})`;
    if (obj instanceof Set) return `Set(${obj.size})`;
    return `${className(obj)}{…}`;
  }
  seen.add(obj);
  try {
    const inner = indent + "  ";
    const join = (open: string, parts: string[], close: string, more: number) => {
      if (more > 0) parts.push(`… ${more} more`);
      if (!parts.length) return `${open}${close}`;
      return multi ? `${open}\n${parts.map((p) => inner + p).join(",\n")}\n${indent}${close}` : `${open} ${parts.join(", ")} ${close}`;
    };
    const next = (v: unknown) => render(v, level + 1, depth, seen, multi, inner);

    const typed = typedName(obj);
    if (typed) {
      const arr = obj as unknown as ArrayLike<number>;
      const shown = Array.from({ length: Math.min(arr.length, MAX_ITEMS) }, (_, i) => String(arr[i]));
      return `${typed}(${arr.length}) ${join("[", shown, "]", arr.length - shown.length)}`;
    }
    if (Array.isArray(obj)) {
      const shown = obj.slice(0, MAX_ITEMS).map(next);
      return join("[", shown, "]", obj.length - shown.length);
    }
    if (obj instanceof Map) {
      const entries = [...obj].slice(0, MAX_ITEMS).map(([k, v]) => `${render(k, level + 1, depth, seen, false, inner)} => ${next(v)}`);
      return `Map(${obj.size}) ${join("{", entries, "}", obj.size - entries.length)}`;
    }
    if (obj instanceof Set) {
      const entries = [...obj].slice(0, MAX_ITEMS).map(next);
      return `Set(${obj.size}) ${join("{", entries, "}", obj.size - entries.length)}`;
    }
    const keys = Object.keys(obj);
    const shown = keys.slice(0, MAX_ITEMS).map((k) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      let v: unknown;
      try { v = (obj as Record<string, unknown>)[k]; } catch (err) { return `${key}: [throws ${err instanceof Error ? err.message : String(err)}]`; }
      return `${key}: ${next(v)}`;
    });
    return `${className(obj)}${join("{", shown, "}", keys.length - shown.length)}`;
  } finally {
    seen.delete(obj);
  }
}
