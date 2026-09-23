/**
 * The worked examples in the playground's list, each one a snippet that runs as it is.
 * `tests/examples.test.ts` type-checks every one against the published typings, so an API
 * change that breaks one turns the check red rather than leaving a broken example here.
 * The comments are the lesson; keep them short and about what the call does.
 */

export interface Example {
  id: string;
  title: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "read-map",
    title: "Read the open map",
    code: `// \`api\` is already in scope. Press Ctrl+Enter, or Run, and read the output below.
// Hover over any name to see its documentation; type \`api.\` to see what is there.
const info = api.document.info();
if (!info) {
  console.log("No map is open. Make one with File > New, then run this again.");
} else {
  console.log(\`\${info.name || "(untitled)"}: \${info.width} × \${info.height} tiles, \${info.tileset}\`);
  console.log("Units on the map:", api.document.scenario()?.units.length);
  console.log("Start locations:", api.query.startLocations());
  console.log("Statistics:", api.query.statistics());
}
`,
  },
  {
    id: "paint-terrain",
    title: "Paint terrain as one undo step",
    code: `// Everything inside document.edit is one entry in Edit > Undo, however many
// operations it makes. The function must be synchronous: await before the call,
// never inside it. Undo Run, above the editor, undoes the last run's edits.
const types = api.terrain.types();
console.log("Flat terrains on this tileset:", types.map((t) => t.name));
if (types.length < 2) {
  console.warn("The tileset graphics are not loaded, so there is nothing to paint with.");
} else {
  const view = api.view.visible();
  const size = 12;
  const x0 = Math.floor((view.x0 + view.x1 - size) / 2);
  const y0 = Math.floor((view.y0 + view.y1 - size) / 2);
  const result = api.document.edit("Playground: a square of terrain", (tx) => {
    tx.fillFlat({ x0, y0, x1: x0 + size, y1: y0 + size }, types[1].id);
  });
  console.log(result);
  api.view.flash({ rect: { x0, y0, x1: x0 + size, y1: y0 + size } });
}
`,
  },
  {
    id: "place-units",
    title: "Place units in a ring",
    code: `// Positions are in map pixels; api.consts.tile is the size of one tile (32).
// placeUnit applies the Units palette's snapping; canPlaceUnit asks its checks first.
const MARINE = 0;
const tile = api.consts.tile;
const view = api.view.visible();
const cx = ((view.x0 + view.x1) / 2) * tile;
const cy = ((view.y0 + view.y1) / 2) * tile;
const placed = api.document.edit("Playground: a ring of marines", (tx) => {
  let n = 0;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(angle) * 4 * tile);
    const y = Math.round(cy + Math.sin(angle) * 4 * tile);
    if (tx.canPlaceUnit(MARINE, x, y)) { tx.placeUnit(MARINE, 0, x, y); n++; }
  }
  return n;
});
console.log(\`Placed \${placed.units} \${api.names.unit(MARINE)} for \${api.names.player(0)}.\`);
`,
  },
  {
    id: "events",
    title: "Listen to what the user does",
    code: `// A listener stays until you press Stop or run again: the playground takes back
// everything a run registered. Paint something, select a unit, then look below.
api.events.on("commit", (e) => {
  console.log(\`\${e.reason}: \${e.label ?? "(no label)"}\`, e.area);
});
api.events.on("selection", () => {
  console.log("Selected units:", api.selection.units());
});
console.log("Listening. Press Stop to remove both listeners.");
`,
  },
  {
    id: "menu-item",
    title: "Add a menu item and a hotkey",
    code: `// Open the Tools menu after running this. Stop removes the item and the hotkey,
// the same way turning a plugin off does.
function countUnits() {
  const units = api.document.scenario()?.units ?? [];
  const byOwner = new Map<number, number>();
  for (const u of units) byOwner.set(u.owner, (byOwner.get(u.owner) ?? 0) + 1);
  const lines = [...byOwner].sort((a, b) => a[0] - b[0]).map(([p, n]) => \`\${api.names.player(p)}: \${n}\`);
  void api.ui.alert(lines.join("\\n") || "There are no units on this map.", { title: "Units by owner" });
}
api.menu.add("Tools", { label: "Count Units by Owner", enabled: () => api.document.isOpen(), run: countUnits });
api.hotkeys.add("Ctrl+Shift+U", countUnits);
console.log("Added Tools > Count Units by Owner, and Ctrl+Shift+U.");
`,
  },
  {
    id: "panel",
    title: "A panel built from widgets",
    code: `// A plugin's UI is plain DOM. api.ui.widgets makes it in the editor's own styles.
const w = api.ui.widgets;
api.ui.panel({
  title: "Zoom",
  mount(body) {
    const label = w.hint("");
    const show = () => { label.textContent = \`Zoom: \${Math.round(api.view.zoom() * 100)}%\`; };
    show();
    const listener = api.events.on("view", show);
    body.append(
      label,
      w.row(
        w.button("50%", { onClick: () => api.view.setZoom(0.5) }),
        w.button("100%", { onClick: () => api.view.setZoom(1) }),
        w.button("200%", { onClick: () => api.view.setZoom(2) }),
      ),
    );
    return () => listener.dispose();
  },
});
`,
  },
  {
    id: "overlay",
    title: "Draw over the map",
    code: `// An overlay draws on every repaint and never takes the mouse. view.x() and view.y()
// turn map pixels into canvas pixels at the current zoom and scroll.
const overlay = api.ui.overlay({
  name: "Playground: start locations",
  above: "objects",
  draw(ctx, view) {
    ctx.lineWidth = 2;
    for (const s of api.query.startLocations()) {
      ctx.strokeStyle = api.palette.playerColor(s.owner);
      ctx.beginPath();
      ctx.arc(view.x(s.x), view.y(s.y), 3 * view.tilePx, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
});
// Redraw when units move, since start locations are units.
api.events.on("units", () => overlay.redraw());
console.log("Rings around each start location. The View menu can hide the overlay.");
`,
  },
  {
    id: "map-tool",
    title: "A map tool: clear fog with a brush",
    code: `// A map tool owns the mouse until it stops (Esc, right-click, or Stop here).
// This one clears fog of war for every player under a round brush as you drag.
const RADIUS = 3;
const ALL_PLAYERS = 0xff;
// Cells are tile indices, y * width + x, and must be inside the map.
function brush(cx: number, cy: number, width: number, height: number): number[] {
  const cells: number[] = [];
  for (let y = cy - RADIUS; y <= cy + RADIUS; y++)
    for (let x = cx - RADIUS; x <= cx + RADIUS; x++)
      if (x >= 0 && y >= 0 && x < width && y < height && (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS * RADIUS) cells.push(y * width + x);
  return cells;
}
function clear(p: { tx: number; ty: number }) {
  api.document.edit("Playground: clear fog", (tx) => tx.setFog(brush(p.tx, p.ty, tx.width, tx.height), ALL_PLAYERS, "clear"));
}
let hover: { tx: number; ty: number } | null = null;
const tool = api.ui.mapTool({
  name: "Clear fog",
  hint: "Drag to clear fog of war. Esc stops.",
  cursor: "crosshair",
  onDown(p) { if (p.inMap) clear(p); },
  onMove(p) {
    hover = p.inMap ? { tx: p.tx, ty: p.ty } : null;
    if (p.down && p.inMap) clear(p);
    tool.redraw();
  },
  draw(ctx, view) {
    if (!hover) return;
    ctx.strokeStyle = "#4fd1c5";
    ctx.beginPath();
    ctx.arc(view.x((hover.tx + 0.5) * api.consts.tile), view.y((hover.ty + 0.5) * api.consts.tile), (RADIUS + 0.5) * view.tilePx, 0, Math.PI * 2);
    ctx.stroke();
  },
  onStop(reason) { console.log("The tool stopped:", reason); },
});
`,
  },
  {
    id: "trigger",
    title: "Write a trigger from text",
    code: `// document.update writes the tables the Scenario dialogs write: triggers, strings,
// players, unit settings. fromText reads the text format of Scenario > Triggers.
const source = \`
Trigger("All players"){
Conditions:
  Always();
Actions:
  Display Text Message(Always Display, "Hello from the API Playground");
}\`;
const result = api.document.update("Playground: add a trigger", (tx) => {
  tx.triggers.fromText(source);
});
console.log(result);
const last = api.triggers.list().at(-1);
if (last) console.log(api.triggers.summarize(last));
`,
  },
  {
    id: "wait",
    title: "Ask, wait, then edit",
    code: `// Everything that waits returns a promise, and a snippet can await at the top.
// Do the waiting first; the edit itself must not await.
const name = await api.ui.prompt("A new name for the map:", { value: api.document.info()?.name ?? "" });
if (name === null) {
  console.log("Cancelled.");
} else {
  const area = await api.ui.pickArea({ prompt: "Drag an area to mark with a location" });
  api.document.update("Playground: rename", (tx) => tx.properties({ name }));
  if (area) {
    const tile = api.consts.tile;
    api.document.edit("Playground: a location", (tx) => {
      tx.addLocation({ left: area.x0 * tile, top: area.y0 * tile, right: area.x1 * tile, bottom: area.y1 * tile }, name);
    });
  }
  console.log("Done:", api.document.info()?.name);
}
`,
  },
];

/** The snippet a first visit opens with. */
export const FIRST = EXAMPLES[0];
