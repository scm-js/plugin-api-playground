/**
 * The one thing the playground needs from a source map: which line of the snippet a line
 * of the emitted JavaScript came from, so that an error thrown at `blob:…:14:7` can be
 * shown on the snippet's own line. TypeScript drops interfaces and type-only lines when it
 * emits, so the two drift apart in any snippet that declares a type.
 */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((c, i) => [c, i]));

/** One segment's fields, VLQ-decoded: each is relative to the previous segment's. */
function decodeSegment(text: string): number[] {
  const out: number[] = [];
  let value = 0, shift = 0;
  for (const c of text) {
    const digit = DIGIT.get(c);
    if (digit === undefined) return out;
    value += (digit & 31) << shift;
    if (digit & 32) { shift += 5; continue; }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return out;
}

/**
 * For each generated line (index 0 = line 1), the original line (1-based) its first mapped
 * segment points at, or 0 for a line with no mapping.
 */
export function lineTable(mappings: string): number[] {
  const table: number[] = [];
  let originalLine = 0;
  for (const line of mappings.split(";")) {
    let first = 0;
    for (const seg of line.split(",")) {
      if (!seg) continue;
      const f = decodeSegment(seg);
      if (f.length < 4) continue;
      // Fields: generated column, source index, original line, original column (all deltas but the column resets per line).
      originalLine += f[2];
      if (!first) first = originalLine + 1;
    }
    table.push(first);
  }
  return table;
}

/** The snippet line behind emitted line `line` (1-based), falling back to the nearest mapped line above it. */
export function originalLine(table: number[], line: number): number | null {
  for (let i = Math.min(line, table.length) - 1; i >= 0; i--) if (table[i]) return table[i];
  return null;
}
