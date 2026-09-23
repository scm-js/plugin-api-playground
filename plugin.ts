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
import { Playground } from "./panel";

export default function activate(api: PluginApi) {
  api.i18n.register({ ko: KO });
  const t = (text: string, params?: Record<string, string | number>) => api.i18n.t(text, params);
  const playground = new Playground(api, t);

  api.commands.register({ id: "open", title: t("API Playground"), run: () => playground.toggle() });
  api.menu.add("Tools", { label: t("API Playground"), icon: "plugin", command: "open" });

  return () => playground.dispose();
}
