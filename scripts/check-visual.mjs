#!/usr/bin/env node
import assert from "node:assert/strict";
import Jimp from "jimp";
import { parseLookResponse } from "../src/outline.ts";
import { buildVisualSnapshot, describeClusters, elementAt } from "../src/visual/snapshot.ts";
import { renderAimPreview, renderOverview } from "../src/visual/overlays.ts";

const png = await new Jimp(400, 300, 0xffffffff).getBufferAsync(Jimp.MIME_PNG);
const raw = {
	lookId: "l1",
	window: { windowId: 1, framePoints: { x: 10, y: 10, w: 400, h: 300 }, scaleFactor: 1 },
	image: { jpegBase64: png.toString("base64"), mimeType: "image/png", width: 400, height: 300 },
	outline: {
		role: "frame",
		title: "Demo Window",
		rect: { x: 10, y: 10, w: 400, h: 300 },
		actions: ["press"],
		children: [
			{
				role: "panel",
				rect: { x: 10, y: 10, w: 400, h: 300 },
				actions: ["press"],
				children: [
					{ role: "push button", title: "Back", rect: { x: 30, y: 30, w: 20, h: 20 }, actions: ["press"] },
					{ role: "push button", title: "Forward", rect: { x: 44, y: 30, w: 20, h: 20 }, actions: ["press"] },
					{ role: "push button", title: "Reload", rect: { x: 58, y: 30, w: 20, h: 20 }, actions: ["press"] },
					{ role: "push button", title: "Minimize", rect: { x: 30, y: -20, w: 20, h: 20 }, actions: ["press"] },
					{ role: "entry", isTextInput: true, focused: true, value: "hello", rect: { x: 120, y: 100, w: 160, h: 24 } },
					{ role: "static", value: "Hello \uFFFC world", rect: { x: 40, y: 150, w: 200, h: 20 } },
					{ role: "static", value: "Demo Window", rect: { x: 40, y: 260, w: 200, h: 20 } },
				],
			},
		],
	},
};

const look = parseLookResponse(raw);
const snapshot = buildVisualSnapshot(look, { app: "Demo" });
assert.equal(snapshot.window.title, "Demo Window");
assert.equal(snapshot.elements.length, 4, "containers, off-capture nodes, and statics are not elements");
assert.deepEqual(snapshot.elements.map((element) => element.id), [1, 2, 3, 4]);
assert.deepEqual(snapshot.elements[0].rect, [20, 20, 20, 20]);
assert.equal(snapshot.elements[3].focused, true);
assert.equal(snapshot.clusters.length, 1, "the three toolbar buttons cluster");
assert.equal(snapshot.clusters[0].id, "C1");
assert.deepEqual(snapshot.clusters[0].elements, [1, 2, 3]);
assert.equal(elementAt(snapshot, 25, 25)[0]?.id, 1);
assert.equal(snapshot.text.length, 1);
assert.equal(snapshot.text[0], "Hello  world");
assert.equal(snapshot.truncated.text, false);
const lines = describeClusters(snapshot);
assert.equal(lines.length, 1);
assert.match(lines[0], /^C1 at \(\d+,\d+\): 1 push button "Back" \| 2 push button "Forward" \| 3 push button "Reload"$/);

const capped = buildVisualSnapshot(look, { maxTextChars: 5 });
assert.deepEqual(capped.text, ["Hello"]);
assert.equal(capped.truncated.text, true);

const overview = await renderOverview(look, snapshot, { maxEdge: 1536 });
const rendered = await Jimp.read(overview);
assert.equal(rendered.bitmap.width, 400);
assert.equal(rendered.bitmap.height, 300);
let orange = 0;
rendered.scan(0, 0, rendered.bitmap.width, rendered.bitmap.height, (_x, _y, idx) => {
	const data = rendered.bitmap.data;
	if (data[idx] === 255 && data[idx + 1] === 122 && data[idx + 2] === 0) orange += 1;
});
assert.ok(orange > 100, `expected orange element outlines in the render, found ${orange}px`);

const preview = await renderAimPreview(look, snapshot, { x: 30, y: 30 }, { maxEdge: 1536 });
const crop = await Jimp.read(preview.crop);
assert.equal(crop.bitmap.width, 320 * 2.5);
assert.equal(crop.bitmap.height, 240 * 2.5);
const previewOverview = await Jimp.read(preview.overview);
assert.equal(previewOverview.bitmap.width, 400);

console.log("Visual snapshot, cluster, and overlay checks passed");
