/**
 * API Playground: try the plugin API without writing a plugin.
 *
 * Tools ▸ API Playground opens a panel with a code editor where `api` is in scope, with
 * completion and the API's own documentation on hover. Ctrl+Enter runs the snippet against
 * the open map; Stop takes back everything the run registered (`api.scope()`). Snippets
 * are kept in the browser, the examples are the API's main ideas one at a time, and Export
 * as Plugin turns a snippet into the files of a new plugin.
 */
import type { PluginApi } from "@scm-js/plugin-api";
import { KO } from "./ko";
import { decodeSnippet, takeFromAddress } from "./link";
import { Playground } from "./panel";

/** Resolves once the map is on screen (the splash has gone), or after `ms` in any case. */
function whenMapShown(api: PluginApi, ms = 20000): Promise<void> {
  const shown = () => { const r = api.view.visible(); return r.x1 > r.x0 && r.y1 > r.y0; };
  if (shown()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); sub.dispose(); resolve(); };
    const sub = api.events.on("view", () => { if (shown()) done(); });
    const timer = setTimeout(done, ms);
  });
}

export default function activate(api: PluginApi) {
  api.i18n.register({ ko: KO });
  const t = (text: string, params?: Record<string, string | number>) => api.i18n.t(text, params);
  const playground = new Playground(api, t);

  api.commands.register({ id: "open", title: t("API Playground"), run: () => playground.toggle() });
  api.menu.add("Tools", { label: t("API Playground"), icon: "plugin", command: "open" });

  // A "Try it" link from the docs, or one a user copied: the snippet goes into the editor, unrun.
  const linked = takeFromAddress();
  if (linked !== null) {
    void decodeSnippet(linked).then(async (code) => {
      await whenMapShown(api);
      if (code === null) api.ui.toast({ kind: "warn", title: t("The link's snippet could not be read"), detail: t("The link may have been cut short when it was copied.") });
      else await playground.openLinked(code);
    });
  }

  return () => playground.dispose();
}
