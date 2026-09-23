/**
 * The plugin API's declarations, as the language service in the editor sees them. The
 * text is `@scm-js/plugin-api`'s one `index.d.ts`, bundled into the plugin when it is
 * built (`--alias:playground-api-types=…` with the `.d.ts` loader set to text), so the
 * completions match the version this release was built against — `TYPES_VERSION`.
 */
import declarations from "playground-api-types";
import pkg from "@scm-js/plugin-api/package.json";

export const TYPES_VERSION: string = pkg.version;

/** Where the package is placed for the language service, so `import type … from "@scm-js/plugin-api"` resolves. */
const PACKAGE_DIR = "file:///node_modules/@scm-js/plugin-api";

/**
 * What a snippet has in scope beyond the standard library: `api`. `console` and the timers
 * are the page's own names; the run hands in its own copies under the same names, so the
 * declarations are the browser's.
 */
const GLOBALS = `declare const api: import("@scm-js/plugin-api").PluginApi;\n`;

export interface ExtraLib { content: string; filePath: string }

export function extraLibs(): ExtraLib[] {
  return [
    { content: JSON.stringify({ name: "@scm-js/plugin-api", version: TYPES_VERSION, types: "index.d.ts" }), filePath: `${PACKAGE_DIR}/package.json` },
    { content: declarations, filePath: `${PACKAGE_DIR}/index.d.ts` },
    { content: GLOBALS, filePath: "file:///playground-globals.d.ts" },
  ];
}
