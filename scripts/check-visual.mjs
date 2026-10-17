#!/usr/bin/env node
import assert from "node:assert/strict";
import Jimp from "jimp";
import { parseLookResponse, serializeOutline } from "../src/outline.ts";
import { cdpSnapshotOutline } from "../src/cdp.ts";
import { formatObservation } from "../src/visual/format.ts";
import { buildBrowserSnapshot, browserCaptureSource } from "../src/visual/browser.ts";
import { captureSourceFromLook, renderAimPreview, renderCrop, renderOverview } from "../src/visual/overlays.ts";
import { badgeLabel, buildVisualSnapshot, describeClusters, elementAt, textBlocksFromPage } from "../src/visual/snapshot.ts";

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
assert.ok(snapshot.elements.every((element) => /^@e\d+$/.test(element.ref)), "elements carry outline refs");
assert.deepEqual(snapshot.elements[0].rect, [20, 20, 20, 20]);
assert.equal(snapshot.elements[3].focused, true);
assert.equal(snapshot.clusters.length, 1, "the three toolbar buttons cluster");
assert.equal(snapshot.clusters[0].id, "C1");
assert.equal(snapshot.clusters[0].refs.length, 3);
assert.equal(elementAt(snapshot, 25, 25)[0]?.ref, snapshot.clusters[0].refs[0]);
assert.equal(snapshot.text.length, 1);
assert.equal(snapshot.text[0], "Hello  world");
assert.equal(snapshot.truncated.text, false);
const lines = describeClusters(snapshot);
assert.equal(lines.length, 1);
assert.match(lines[0], /^C1 at \(\d+,\d+\): @e\d+ push button "Back" \| @e\d+ push button "Forward" \| @e\d+ push button "Reload"$/);

assert.equal(badgeLabel("@e12"), "12");
assert.equal(badgeLabel("wire-1"), "wir");

const observation = JSON.parse(formatObservation(snapshot, { stateId: "s1" }));
assert.equal(observation.state, "s1");
assert.equal(observation.elements.length, 4);
assert.equal(observation.elements[0].ref, snapshot.elements[0].ref);
assert.deepEqual(observation.elements[0].rect, [20, 20, 20, 20]);
assert.equal(observation.clusters[0].refs.length, 3);
assert.deepEqual(observation.text, ["Hello  world"]);
assert.equal(observation.textTruncated, undefined);
assert.equal(observation.elementsOmitted, undefined);

const cappedObservation = JSON.parse(formatObservation(snapshot, { stateId: "s1", maxElements: 2 }));
assert.equal(cappedObservation.elements.length, 2);
assert.equal(cappedObservation.elementsOmitted, 2);

const truncatedSnapshot = buildVisualSnapshot(look, { maxTextChars: 5 });
assert.deepEqual(truncatedSnapshot.text, ["Hello"]);
assert.equal(truncatedSnapshot.truncated.text, true);
const truncatedObservation = JSON.parse(formatObservation(truncatedSnapshot, { stateId: "s2" }));
assert.equal(truncatedObservation.textTruncated, true);

const source = captureSourceFromLook(look);
assert.ok(source, "the desktop look must provide a capture source");
const overview = await renderOverview(source, snapshot, { maxEdge: 1536 });
const rendered = await Jimp.read(overview);
assert.equal(rendered.bitmap.width, 400);
assert.equal(rendered.bitmap.height, 300);
let orange = 0;
rendered.scan(0, 0, rendered.bitmap.width, rendered.bitmap.height, (_x, _y, idx) => {
	const data = rendered.bitmap.data;
	if (data[idx] === 255 && data[idx + 1] === 122 && data[idx + 2] === 0) orange += 1;
});
assert.ok(orange > 100, `expected orange element outlines in the render, found ${orange}px`);

const preview = await renderAimPreview(source, snapshot, { x: 30, y: 30 }, { maxEdge: 1536 });
const crop = await Jimp.read(preview.crop);
assert.equal(crop.bitmap.width, 320 * 2.5);
assert.equal(crop.bitmap.height, 240 * 2.5);
const previewOverview = await Jimp.read(preview.overview);
assert.equal(previewOverview.bitmap.width, 400);

const zoomed = await Jimp.read(await renderCrop(source, { x: 40, y: 40, w: 200, h: 100 }, { zoom: 2 }));
assert.equal(zoomed.bitmap.width, 400);
assert.equal(zoomed.bitmap.height, 200);

assert.deepEqual(textBlocksFromPage("A\n\nB\n\nB\n\nC"), ["A", "B", "C"]);

const axTransform = cdpSnapshotOutline("snap-1", [
	{ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3"] },
	{ nodeId: "2", parentId: "1", role: { value: "textField" }, name: { value: "" }, value: { value: "seed" }, backendDOMNodeId: 42, properties: [{ name: "editable", value: { type: "boolean", value: true } }] },
	{ nodeId: "3", parentId: "1", role: { value: "toggleButton" }, name: { value: "Mute" }, backendDOMNodeId: 43 },
]);
assert.equal(axTransform.targets.length, 2, "editable and toggle targets must be actionable");
const axField = axTransform.targets.find((target) => target.role === "textField");
assert.ok(axField?.actions.includes("set_text"), "editable AX nodes must accept set_text");
assert.equal(axField?.backendNodeId, 42);
assert.equal(axField?.value, "seed", "unnamed inputs are identified by value");
assert.ok(axTransform.targets.find((target) => target.role === "toggleButton")?.actions.includes("click"));
assert.equal(axTransform.outline.root.ref, "@e1", "AX nodes become @e refs in tree order");

const browserOutline = {
	ref: "cdp:1",
	role: "document",
	title: "Demo Page",
	children: [
		{ ref: "cdp:2", role: "button", title: "Go", actions: ["click"], rect: { x: 40, y: 40, w: 80, h: 30 } },
		{ ref: "cdp:3", role: "textbox", title: "Search", actions: ["click", "set_text"], isTextInput: true, rect: { x: 40, y: 90, w: 200, h: 30 } },
	],
};
const browserParsed = parseLookResponse({
	lookId: "browser",
	window: { windowId: 0, framePoints: { x: 0, y: 0, w: 800, h: 600 }, scaleFactor: 1 },
	outline: browserOutline,
	timings: {},
});
const browser = {
	contextId: "browser:ctx",
	snapshotId: "B1",
	targetId: "t",
	title: "Demo Page",
	url: "https://example.test/",
	capturedAt: 0,
	text: "First paragraph.\n\nSecond paragraph.",
	targets: [],
	outline: serializeOutline(browserParsed.parsedOutline),
	viewport: { width: 800, height: 600, scale: 1 },
	scroll: { x: 0, y: 0 },
	image: { base64: png.toString("base64"), mimeType: "image/png", width: 400, height: 300 },
	diagnostics: { cdp: "connected", targetCount: 2 },
};
const browserSnapshot = buildBrowserSnapshot(browser, { app: "Browser" });
assert.equal(browserSnapshot.window.url, "https://example.test/");
assert.equal(browserSnapshot.window.app, "Browser");
assert.deepEqual(browserSnapshot.text, ["First paragraph.", "Second paragraph."]);
assert.equal(browserSnapshot.elements.length, 2);
assert.equal(browserSnapshot.elements[0].role, "button");
assert.equal(browserSnapshot.elements[0].name, "Go");
assert.deepEqual(browserSnapshot.elements[0].rect, [20, 20, 40, 15], "viewport rects scale into capture pixels");
assert.equal(browserSnapshot.clusters.length, 1, "dense browser controls cluster into one marker");
const browserObservation = JSON.parse(formatObservation(browserSnapshot, { stateId: "B1" }));
assert.equal(browserObservation.url, "https://example.test/");
assert.deepEqual(browserObservation.elements[0].rect, [20, 20, 40, 15]);

const browserSource = browserCaptureSource(browser);
assert.ok(browserSource, "the browser snapshot with an image must provide a capture source");
const browserOverview = await Jimp.read(await renderOverview(browserSource, browserSnapshot, { maxEdge: 400 }));
assert.equal(browserOverview.bitmap.width, 400);
assert.equal(browserOverview.bitmap.height, 300);
const browserCrop = await Jimp.read(await renderCrop(browserSource, { x: 16, y: 16, w: 48, h: 24 }, { zoom: 3 }));
assert.equal(browserCrop.bitmap.width, 144);
assert.equal(browserCrop.bitmap.height, 72);

console.log("Visual snapshot, cluster, format, and overlay checks passed");
