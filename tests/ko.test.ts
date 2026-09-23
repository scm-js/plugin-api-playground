import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../examples";
import { KO } from "../ko";

// Every literal the plugin shows through `t("…")`, read from the source the way the editor's
// own extractor reads it, and every example's title, which the list shows through `t`.
const root = new URL("../", import.meta.url);
const keys = new Set(EXAMPLES.map((e) => e.title));
for (const file of readdirSync(root).filter((f) => f.endsWith(".ts") && f !== "ko.ts")) {
  const source = readFileSync(new URL(file, root), "utf8");
  for (const m of source.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`) as string);
}

describe("the Korean catalogue", () => {
  it("has every string the plugin shows", () => {
    expect([...keys].filter((k) => !(k in KO))).toEqual([]);
  });

  it("has nothing the plugin no longer shows", () => {
    expect(Object.keys(KO).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("keeps every placeholder", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const [en, ko] of Object.entries(KO)) expect(names(ko), en).toEqual(names(en));
  });
});
