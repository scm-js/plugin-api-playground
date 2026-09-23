/**
 * Saved snippets and the one being edited, in the plugin's storage (`api.storage`, the
 * browser's local storage under the plugin's id). The draft is written as the user types,
 * so closing the panel or the editor loses nothing; saved snippets are named copies.
 */
import type { StorageApi } from "@scm-js/plugin-api";

export interface Saved {
  id: string;
  name: string;
  code: string;
  /** `Date.now()` when last saved. */
  updated: number;
}

export interface Draft {
  code: string;
  /** What the editor was opened from: `saved:<id>`, `example:<id>`, or null for a new snippet. */
  source: string | null;
}

const SAVED_KEY = "snippets";
const DRAFT_KEY = "draft";

export class Library {
  private readonly storage: StorageApi;

  constructor(storage: StorageApi) {
    this.storage = storage;
  }

  list(): Saved[] {
    const raw = this.storage.get<Saved[]>(SAVED_KEY, []);
    return Array.isArray(raw) ? raw.filter((s) => s && typeof s.id === "string" && typeof s.code === "string") : [];
  }

  get(id: string): Saved | null {
    return this.list().find((s) => s.id === id) ?? null;
  }

  /** Save `code` under `name`: over `id` when given, else as a new snippet. False when the browser refused (storage full). */
  save(name: string, code: string, id?: string): Saved | null {
    const all = this.list();
    const entry: Saved = { id: id ?? `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, name, code, updated: Date.now() };
    const at = all.findIndex((s) => s.id === entry.id);
    if (at >= 0) all[at] = entry;
    else all.push(entry);
    all.sort((a, b) => a.name.localeCompare(b.name));
    return this.storage.set(SAVED_KEY, all) ? entry : null;
  }

  remove(id: string) {
    this.storage.set(SAVED_KEY, this.list().filter((s) => s.id !== id));
  }

  draft(): Draft | null {
    const d = this.storage.get<Draft | null>(DRAFT_KEY, null);
    return d && typeof d.code === "string" ? { code: d.code, source: typeof d.source === "string" ? d.source : null } : null;
  }

  setDraft(draft: Draft) {
    this.storage.set(DRAFT_KEY, draft);
  }
}
