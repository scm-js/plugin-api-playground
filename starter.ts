/**
 * A snippet that works, turned into the files of a plugin repository: the snippet becomes
 * the body of `activate(api)`, its imports move to the top of the file, and the toolchain
 * is Hello World's (type-check with the published typings, one esbuild call to build).
 */

export interface StarterOptions {
  name: string;
  id: string;
  description: string;
  author: string;
  /** The snippet's source. */
  code: string;
  /** The `@scm-js/plugin-api` version the playground's typings came from; the starter depends on `^` it. */
  typesVersion: string;
}

/** A plugin id from its name, the way the editor derives one when the manifest has none. */
export function idFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
}

/**
 * For each line of `code`, whether it starts inside a template literal — a line the
 * indenting must leave alone, since its leading spaces are part of a string. Strings,
 * comments and `${…}` nesting are followed; a regular expression holding a quote or a
 * backtick is the one thing that can mislead it.
 */
export function linesInsideTemplates(code: string): boolean[] {
  const inside: boolean[] = [false];
  // Each entry is one open template; its number counts the `{` opened inside its current `${`.
  const templates: number[] = [];
  let inTemplateText = false;
  let i = 0;
  const n = code.length;
  const newline = () => inside.push(inTemplateText);
  while (i < n) {
    const c = code[i];
    if (inTemplateText) {
      if (c === "\\") { if (code[i + 1] === "\n") { i++; newline(); } i += 2; continue; }
      if (c === "`") { inTemplateText = false; templates.pop(); i++; continue; }
      if (c === "$" && code[i + 1] === "{") { inTemplateText = false; templates[templates.length - 1] = 0; i += 2; continue; }
      if (c === "\n") newline();
      i++;
      continue;
    }
    if (c === "\n") { newline(); i++; continue; }
    if (c === "/" && code[i + 1] === "/") { while (i < n && code[i] !== "\n") i++; continue; }
    if (c === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) { if (code[i] === "\n") newline(); i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && code[i] !== c && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "`") { templates.push(0); inTemplateText = true; i++; continue; }
    if (templates.length && c === "{") templates[templates.length - 1]++;
    if (templates.length && c === "}") {
      if (templates[templates.length - 1] === 0) { inTemplateText = true; i++; continue; }
      templates[templates.length - 1]--;
    }
    i++;
  }
  return inside;
}

const IMPORT = /^import\b[\s\S]*?["'][^"'\n]+["'][ \t]*;?[ \t]*(?:\r?\n|$)/gm;

/** `plugin.ts` for a snippet: the snippet as the body of `activate`. */
export function snippetToPlugin(code: string, name: string): string {
  const imports: string[] = [];
  const body = code.replace(/\r\n/g, "\n").replace(IMPORT, (m) => { imports.push(m.trim()); return ""; });
  if (!imports.some((line) => /\bPluginApi\b/.test(line) && line.includes("@scm-js/plugin-api"))) {
    imports.unshift('import type { PluginApi } from "@scm-js/plugin-api";');
  }
  const trimmed = body.replace(/^\s*\n/, "").replace(/\s+$/, "");
  const inside = linesInsideTemplates(trimmed);
  const lines = trimmed.split("\n").map((line, i) => {
    if (inside[i]) return line;
    // A top-level export means nothing inside a function; the declaration stays.
    const plain = line.replace(/^export\s+(?=(const|let|var|function|async|class|interface|type|enum)\b)/, "");
    return plain ? `  ${plain}` : "";
  });
  const isAsync = /\bawait\b/.test(trimmed);
  return [
    "/**",
    ` * ${name}: a plugin for the scmJS map editor, started from an API Playground snippet.`,
    " *",
    " * The snippet runs once, when the plugin is turned on. Everything it registers (menu",
    " * items, listeners, panels, overlays) is taken back when the plugin is turned off.",
    " */",
    ...imports,
    "",
    `export default ${isAsync ? "async " : ""}function activate(api: PluginApi) {`,
    ...lines,
    "}",
    "",
  ].join("\n");
}

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": [],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["plugin.ts"]
}
`;

/** Every file of the starter repository, by path. */
export function starterFiles(o: StarterOptions): Record<string, string> {
  const manifest = {
    name: o.name,
    id: o.id,
    version: "0.1.0",
    description: o.description,
    ...(o.author ? { author: o.author } : {}),
    entry: "plugin.ts",
    api: 1,
  };
  const pkg = {
    name: `scmjs-plugin-${o.id}`,
    version: "0.1.0",
    private: true,
    description: `${o.name} — a plugin for the scmJS StarCraft map editor.`,
    ...(o.author ? { author: o.author } : {}),
    license: "MIT",
    type: "module",
    scripts: {
      build: 'esbuild plugin.ts --bundle --format=esm --target=es2022 --platform=browser --outfile=dist/plugin.js --banner:js="// Generated by npm run build - do not edit; the source is plugin.ts."',
      dev: "npm run build -- --watch",
      typecheck: "tsc -p tsconfig.json",
    },
    devDependencies: {
      "@scm-js/plugin-api": `^${o.typesVersion}`,
      esbuild: "^0.28.2",
      typescript: "~5.9.2",
    },
  };
  const readme = `# ${o.name}

${o.description || "A plugin for the scmJS StarCraft map editor."}

Started from a snippet in the API Playground.

## Trying it

\`\`\`sh
npm install
npm run typecheck
npx serve --cors .
\`\`\`

In the editor, open Plugins ▸ Manage Plugins…, paste \`http://localhost:3000/\` and press
Add. The editor reads \`plugin.json\`, transpiles \`plugin.ts\` and runs it. Press **Reload**
on the plugin's row after each change.

## Publishing it

Push the folder to a public GitHub repository; anyone can then install it by its
address, \`github:<owner>/<repository>\`. Before tagging a release, run \`npm run build\`,
commit \`dist/plugin.js\` and add \`"build": "dist/plugin.js"\` to \`plugin.json\`, so the
editor loads the bundle instead of transpiling the source.

[Hello World](https://github.com/scm-js/plugin-hello-world) has the continuous
integration the scm-js plugins use, and the plugin guide is at
https://docs.scmjs.dev/plugins/writing-a-plugin/.
`;
  return {
    "plugin.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "plugin.ts": snippetToPlugin(o.code, o.name),
    "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "tsconfig.json": TSCONFIG,
    ".gitignore": "node_modules/\n",
    "README.md": readme,
  };
}
