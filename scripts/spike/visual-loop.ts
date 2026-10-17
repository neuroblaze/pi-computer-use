import fs from "node:fs/promises";
import path from "node:path";
import { linuxBackend } from "../../src/platform/linux/backend.ts";
import { captureSourceFromLook, renderAimPreview, renderOverview } from "../../src/visual/overlays.ts";
import { buildVisualSnapshot, describeClusters, elementAt } from "../../src/visual/snapshot.ts";

const AIM_ROLES = new Set(["push button", "button", "link", "tab", "menu item", "check box", "checkbox", "radio button", "combo box", "slider", "spin button"]);

function argValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

const appFilter = (argValue("--app") ?? "chromium").toLowerCase();
const maxEdge = Number(argValue("--max") ?? 1536);
const outDir = path.resolve(argValue("--out") ?? "spike-out");

const roots = await linuxBackend.listRoots({});
console.log(`roots: ${roots.length}`);
for (const root of roots) {
	console.log(`  windowId=${root.windowId} app=${root.appName ?? "?"} title=${JSON.stringify(root.title.slice(0, 60))} kind=${root.kind} focused=${root.isFocused}`);
}
const root = roots.find((candidate) => `${candidate.appName ?? ""} ${candidate.title}`.toLowerCase().includes(appFilter))
	?? roots.find((candidate) => candidate.isFocused);
if (!root?.windowId) throw new Error(`No window matched '${appFilter}' (and no focused root).`);

const look = await linuxBackend.observe({
	target: { windowId: root.windowId },
	readText: "never",
	includeImage: true,
}, { timeoutMs: 30_000 });
const frame = look.window.framePoints;
console.log(`window: ${root.appName ?? "?"} "${root.title}" frame=(${frame.x},${frame.y}) ${frame.w}x${frame.h} capture=${look.image?.width ?? 0}x${look.image?.height ?? 0}`);

const snapshot = buildVisualSnapshot(look, { app: root.appName ?? "", maxEdge });
const source = captureSourceFromLook(look);
if (!source) throw new Error("The observation returned no capture image.");
const renderEdge = Math.max(1, source.image.width, source.image.height);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`elements: ${snapshot.elements.length}, clusters: ${snapshot.clusters.length}, text blocks: ${snapshot.text.length}`);
for (const line of describeClusters(snapshot)) console.log(`  ${line}`);

await fs.writeFile(path.join(outDir, "overview.png"), await renderOverview(source, snapshot, { maxEdge: renderEdge }));

const aimed = snapshot.elements
	.filter((element) => element.rect && element.name && AIM_ROLES.has(element.role) && element.rect[2] >= 24 && element.rect[3] >= 16)
	.sort((a, b) => b.rect![2] * b.rect![3] - a.rect![2] * a.rect![3])[0]
	?? snapshot.elements.find((element) => element.rect && element.name)
	?? snapshot.elements.find((element) => element.rect);
if (!aimed?.rect) throw new Error("No interactive elements were found to aim at.");
const aim = { x: Math.round(aimed.rect[0] + aimed.rect[2] / 2), y: Math.round(aimed.rect[1] + aimed.rect[3] / 2) };
const preview = await renderAimPreview(source, snapshot, aim, { maxEdge: renderEdge });
await fs.writeFile(path.join(outDir, "aim-overview.png"), preview.overview);
await fs.writeFile(path.join(outDir, "aim-crop.png"), preview.crop);

const captureW = look.image?.width ?? frame.w;
const scaleX = captureW / Math.max(1, frame.w);
const aimScreen = { x: Math.round(frame.x + aim.x / scaleX), y: Math.round(frame.y + aim.y / scaleX) };
await fs.writeFile(path.join(outDir, "aim.json"), `${JSON.stringify({
	point: aim,
	screenPoint: aimScreen,
	target: aimed,
	candidatesUnderPoint: elementAt(snapshot, aim.x, aim.y),
}, null, 2)}\n`);

console.log(`aim: window(${aim.x},${aim.y}) screen(${aimScreen.x},${aimScreen.y}) -> ${aimed.ref} ${aimed.role} "${aimed.name}"`);
console.log(`wrote ${outDir}/{snapshot.json,overview.png,aim-overview.png,aim-crop.png,aim.json}`);
