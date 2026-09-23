# API Playground

A plugin for the [scmJS](https://github.com/scm-js/scm-js) StarCraft map editor, for
people writing plugins: a code editor where the plugin API is already in scope. Write a
few lines, run them, and see the result on the map and in the output.

Install it from Plugins ▸ Browse Plugins…, then open Tools ▸ API Playground.

![The API Playground beside the map: the "Place units in a ring" example has run, and the marines it placed are on the map](images/api-playground.webp)

## What it does

- **`api` is defined.** The editor is Monaco, the editor VS Code uses, with the plugin
  API's own declarations loaded: type `api.` for completion, and hover over any name for
  its documentation. Type errors are underlined as you type.
- **Ctrl+Enter runs the snippet** against the open map. `console.log` and `api.log` write
  to the output under the editor; objects fold open. An error shows the snippet line it
  came from.
- **Stop removes what the run added.** Menu items, hotkeys, event listeners, panels,
  dialogs, overlays, map tools and timers are all removed, the same way they are when a
  plugin is turned off. Running again stops the previous run first. Closing the panel
  leaves a run in place, so a snippet that adds its own panel or menu item keeps working.
- **Undo Run** undoes the map edits the last run made, while nothing else has been done
  to the map since.
- **Examples** at the top of the list cover reading the map, painting terrain, placing
  units, events, menu items, panels, overlays, map tools, triggers, and awaiting the user.
- **Save** keeps snippets in the browser, under this plugin's storage. What is in the
  editor is also kept as you type.
- **Links.** On [docs.scmjs.dev](https://docs.scmjs.dev/plugins/writing-a-plugin/), an
  example that runs as written has a **Try it** link that opens it here, and **Copy
  Link** makes the same kind of link for your own snippet. A link only puts the snippet
  in the editor; nothing runs until Run is pressed.
- **Export as Plugin…** saves a zip of a new plugin: `plugin.json`, a `plugin.ts` with the
  snippet as the body of `activate(api)`, and the `package.json` and `tsconfig.json` to
  type-check and build it, as in
  [Hello World](https://github.com/scm-js/plugin-hello-world).

A snippet is a module: it can `await` at the top level and `import` from a full URL. It
runs on the page like any plugin, with the same access, so a loop that never ends freezes
the editor tab. Only run code you have read.

## How it works

Each run gets a child of the playground's own API from `api.scope()`. Everything
registered through it is removed with `scope.dispose()`, and after that the child's writes
to the map are refused, so a timer or a request that finishes late cannot change the map.
A plugin that runs other code for a while can use the same call.

The code editor is the Monaco build that [TrigScript](https://github.com/scm-js/plugin-trigscript)
publishes, loaded from jsDelivr the first time the panel opens. The playground loads its own
copy, so the two plugins' editors can be open together without affecting each other. The
plugin API declarations come from the `@scm-js/plugin-api` version named at the foot of
the panel, which is the version this release was built with.

## Developing

```sh
npm install
npm test            # the examples type-check, as snippets and as exported plugins
npm run build       # dist/plugin.js, which the editor loads
npx serve --cors .  # then add http://localhost:3000/ in Plugins ▸ Manage Plugins…
```

The editor has to load `dist/plugin.js` (the manifest's `build`): the source imports the
API declarations as text, which only the build step can do. To load Monaco from somewhere
else, set the plugin storage key `monacoDist` to a folder holding TrigScript's `dist/`.

## License

MIT
