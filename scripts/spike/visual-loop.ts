import fs from "node:fs/promises";
import path from "node:path";
import Jimp from "jimp";
import type { OutlineNode } from "../../src/outline.ts";
import { linuxBackend } from "../../src/platform/linux/backend.ts";

const BLACK = Jimp.rgbaToInt(0, 0, 0, 255);
const WHITE = Jimp.rgbaToInt(255, 255, 255, 255);
const ORANGE = Jimp.rgbaToInt(255, 122, 0, 255);
const RED = Jimp.rgbaToInt(255, 45, 85, 255);
const CYAN = Jimp.rgbaToInt(0, 176, 255, 255);
const GRAY = Jimp.rgbaToInt(158, 158, 158, 255);

type Img = InstanceType<typeof Jimp>;

function argValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function pixel(img: Img, x: number, y: number, color: number): void {
	x = Math.round(x);
	y = Math.round(y);
	if (x < 0 || y < 0 || x >= img.bitmap.width || y >= img.bitmap.height) return;
	img.setPixelColor(color, x, y);
}

function fillRect(img: Img, x: number, y: number, w: number, h: number, color: number): void {
	for (let py = Math.round(y); py < Math.round(y + h); py += 1) {
		for (let px = Math.round(x); px < Math.round(x + w); px += 1) pixel(img, px, py, color);
	}
}

function strokeRect(img: Img, x: number, y: number, w: number, h: number, thickness: number, color: number): void {
	fillRect(img, x, y, w, thickness, color);
	fillRect(img, x, y + h - thickness, w, thickness, color);
	fillRect(img, x, y, thickness, h, color);
	fillRect(img, x + w - thickness, y, thickness, h, color);
}

function lineH(img: Img, x0: number, x1: number, y: number, color: number): void {
	for (let x = Math.round(Math.min(x0, x1)); x <= Math.round(Math.max(x0, x1)); x += 1) pixel(img, x, y, color);
}

function lineV(img: Img, y0: number, y1: number, x: number, color: number): void {
	for (let y = Math.round(Math.min(y0, y1)); y <= Math.round(Math.max(y0, y1)); y += 1) pixel(img, x, y, color);
}

function circleFill(img: Img, cx: number, cy: number, r: number, color: number): void {
	for (let y = -r; y <= r; y += 1) {
		for (let x = -r; x <= r; x += 1) {
			if (x * x + y * y <= r * r) pixel(img, cx + x, cy + y, color);
		}
	}
}

function circleStroke(img: Img, cx: number, cy: number, r: number, color: number): void {
	const steps = Math.max(24, Math.round(r * 8));
	for (let i = 0; i < steps; i += 1) {
		const angle = (i / steps) * Math.PI * 2;
		pixel(img, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, color);
	}
}

function chipText(img: Img, font: Parameters<Img["print"]>[0], x: number, y: number, text: string, fg: number, bg: number): { w: number; h: number } {
	const w = Jimp.measureText(font, text);
	const h = Jimp.measureTextHeight(font, text, 10000);
	fillRect(img, x, y, w + 8, h + 4, bg);
	img.print(font, x + 4, y + 2, text, 10000, fg);
	return { w: w + 8, h: h + 4 };
}

function badge(img: Img, font: Parameters<Img["print"]>[0], cx: number, cy: number, label: string): void {
	circleFill(img, cx, cy, 11, BLACK);
	circleFill(img, cx, cy, 9, ORANGE);
	const w = Jimp.measureText(font, label);
	const h = Jimp.measureTextHeight(font, label, 10000);
	img.print(font, Math.round(cx - w / 2), Math.round(cy - h / 2), label, 10000, WHITE);
}

function sanitizeName(node: OutlineNode): string {
	const raw = [node.title, node.description].map((value) => value.trim()).find(Boolean) ?? "";
	if (!raw) return "";
	if (/^[\uFFFC\s]+$/.test(raw)) return "";
	if (raw.startsWith("/org/") || raw.includes("/org/a11y/")) return "";
	return raw;
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
if (!look.image) throw new Error("The helper returned no image for this window.");

const native = await Jimp.read(Buffer.from(look.image.jpegBase64, "base64"));
const nativeW = native.bitmap.width;
const nativeH = native.bitmap.height;
const frame = look.window.framePoints;
const scaleX = nativeW / Math.max(1, frame.w);
const scaleY = nativeH / Math.max(1, frame.h);
console.log(`window: ${root.appName ?? "?"} "${root.title}" frame=(${frame.x},${frame.y}) ${frame.w}x${frame.h} capture=${nativeW}x${nativeH}`);

const INTERACTIVE_ROLES = new Set([
	"push button", "button", "toggle button", "link", "entry", "textbox",
	"checkbox", "check box", "radio button", "combo box", "menu item",
	"check menu item", "radio menu item", "tab", "slider", "spin button",
]);
const TEXT_ROLES = new Set(["static", "paragraph", "heading", "label", "caption", "text"]);

const cleanText = (value: string): string => value.replace(/\uFFFC/g, "").trim();
const nodes = look.parsedOutline?.nodes ?? [];
const windowArea = Math.max(1, frame.w * frame.h);
const insideCapture = (node: OutlineNode): boolean => {
	if (!node.rect) return false;
	const x = node.rect.x - frame.x;
	const y = node.rect.y - frame.y;
	return x + node.rect.w > 0 && y + node.rect.h > 0 && x < frame.w && y < frame.h;
};
const interactive = nodes.filter((node) => {
	if (!node.rect || node.offscreen || !insideCapture(node)) return false;
	const role = node.role.toLowerCase();
	if (!(INTERACTIVE_ROLES.has(role) || node.isTextInput || node.canSetValue)) return false;
	if (node.rect.w * node.rect.h > 0.6 * windowArea) return false;
	return Boolean(sanitizeName(node) || cleanText(node.value) || node.isTextInput);
});

const elements = interactive.map((node, index) => ({
	id: index + 1,
	role: node.role.toLowerCase(),
	name: sanitizeName(node),
	value: cleanText(node.value) || undefined,
	rect: [
		Math.round((node.rect!.x - frame.x) * scaleX),
		Math.round((node.rect!.y - frame.y) * scaleY),
		Math.round(node.rect!.w * scaleX),
		Math.round(node.rect!.h * scaleY),
	] as [number, number, number, number],
	actions: node.actions,
	focused: node.focused || undefined,
}));

const textBlocks: string[] = [];
for (const node of nodes) {
	if (!TEXT_ROLES.has(node.role.toLowerCase()) || !insideCapture(node)) continue;
	const text = cleanText(node.value) || sanitizeName(node);
	if (!text || textBlocks[textBlocks.length - 1] === text) continue;
	textBlocks.push(text);
}

const snapshot = {
	window: {
		app: root.appName ?? "",
		title: root.title,
		screen: [frame.x, frame.y],
		size: [frame.w, frame.h],
	},
	elements,
	text: textBlocks.slice(0, 40),
	truncated: { text: textBlocks.length > 40 },
};
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`elements: ${elements.length} (interactive nodes: ${interactive.length} of ${nodes.length}), text blocks: ${textBlocks.length}`);

const font16 = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
const font8 = await Jimp.loadFont(Jimp.FONT_SANS_8_WHITE);

const overviewScale = Math.min(1, maxEdge / Math.max(nativeW, nativeH));
const overviewW = Math.round(nativeW * overviewScale);
const overviewH = Math.round(nativeH * overviewScale);
const overview = native.clone().scale(overviewScale);

fillRect(overview, 0, 0, overviewW, 14, BLACK);
fillRect(overview, 0, 0, 40, overviewH, BLACK);
for (let i = 0; i <= 10; i += 1) {
	const fx = Math.round((i / 10) * (overviewW - 41)) + 40;
	chipText(overview, font8, Math.min(fx, overviewW - 34), 2, String(Math.round(frame.x + (i / 10) * frame.w)), WHITE, BLACK);
	const fy = Math.round((i / 10) * (overviewH - 15)) + 14;
	if (fy + 12 < overviewH) chipText(overview, font8, 2, Math.min(fy, overviewH - 14), String(Math.round(frame.y + (i / 10) * frame.h)), WHITE, BLACK);
}

for (const element of elements) {
	const [x, y, w, h] = element.rect.map((value) => value * overviewScale) as [number, number, number, number];
	strokeRect(overview, x, y, Math.max(w, 2), Math.max(h, 2), 4, BLACK);
	strokeRect(overview, x, y, Math.max(w, 2), Math.max(h, 2), 2, ORANGE);
	const badgeY = y - 13 > 16 ? y - 13 : y + 13;
	badge(overview, font16, x + 11, badgeY, String(element.id));
}
await overview.writeAsync(`${outDir}/overview.png`);

const AIM_ROLES = new Set(["push button", "button", "link", "tab", "menu item", "check box", "checkbox", "radio button", "combo box", "slider", "spin button"]);
const aimed = elements
	.filter((element) => element.name && AIM_ROLES.has(element.role) && element.rect[2] >= 24 && element.rect[3] >= 16)
	.sort((a, b) => b.rect[2] * b.rect[3] - a.rect[2] * a.rect[3])[0]
	?? elements.find((element) => element.name)
	?? elements[0];
if (!aimed) throw new Error("No interactive elements were found to aim at.");
const aim = { x: Math.round(aimed.rect[0] + aimed.rect[2] / 2), y: Math.round(aimed.rect[1] + aimed.rect[3] / 2) };
const aimOverlay = overview.clone();
const crossX = Math.round((aim.x + 0.5) * overviewScale);
const crossY = Math.round((aim.y + 0.5) * overviewScale);
lineH(aimOverlay, 40, overviewW, crossY, RED);
lineV(aimOverlay, 14, overviewH, crossX, RED);
circleStroke(aimOverlay, crossX, crossY, 16, RED);
const aimScreen = { x: Math.round(frame.x + aim.x * scaleX), y: Math.round(frame.y + aim.y * scaleY) };
chipText(aimOverlay, font8, Math.max(41, crossX + 14), Math.max(15, crossY + 12), `aim ${aimScreen.x},${aimScreen.y}`, WHITE, RED);
await aimOverlay.writeAsync(`${outDir}/aim-overview.png`);

const cropW = Math.min(320, nativeW);
const cropH = Math.min(240, nativeH);
const cropX = Math.max(0, Math.min(nativeW - cropW, Math.round(aim.x - cropW / 2)));
const cropY = Math.max(0, Math.min(nativeH - cropH, Math.round(aim.y - cropH / 2)));
const zoom = 2.5;
const crop = native.clone().crop(cropX, cropY, cropW, cropH).scale(zoom);
const zw = crop.bitmap.width;
const zh = crop.bitmap.height;
for (let step = 0; step <= cropW; step += 10) {
	if ((cropX + step) % 50 === 0) continue;
	lineV(crop, 0, zh, step * zoom, GRAY);
}
for (let step = 0; step <= cropH; step += 10) {
	if ((cropY + step) % 50 === 0) continue;
	lineH(crop, 0, zw, step * zoom, GRAY);
}
for (let step = 0; step <= cropW; step += 50) {
	const sx = step * zoom;
	lineV(crop, 0, zh, sx, CYAN);
	chipText(crop, font8, sx + 2, 2, String(cropX + step + frame.x), WHITE, CYAN);
}
for (let step = 0; step <= cropH; step += 50) {
	const sy = step * zoom;
	lineH(crop, 0, zw, sy, CYAN);
	chipText(crop, font8, 2, sy + 2, String(cropY + step + frame.y), WHITE, CYAN);
}
const centerX = Math.round((aim.x - cropX) * zoom);
const centerY = Math.round((aim.y - cropY) * zoom);
lineH(crop, 0, zw, centerY, RED);
lineV(crop, 0, zh, centerX, RED);
circleStroke(crop, centerX, centerY, 14, RED);
chipText(crop, font8, 2, zh - 14, `aim screen ${aimScreen.x},${aimScreen.y} -> e${aimed.id} ${aimed.role} "${aimed.name}"`, WHITE, BLACK);
await crop.writeAsync(`${outDir}/aim-crop.png`);

await fs.writeFile(path.join(outDir, "aim.json"), `${JSON.stringify({
	point: aim,
	screenPoint: aimScreen,
	crop: { x: cropX, y: cropY, w: cropW, h: cropH, zoom },
	target: aimed,
	candidatesUnderPoint: elements.filter((element) => {
		const [x, y, w, h] = element.rect;
		return aim.x >= x && aim.x < x + w && aim.y >= y && aim.y < y + h;
	}),
}, null, 2)}\n`);

console.log(`aim: window(${aim.x},${aim.y}) screen(${aimScreen.x},${aimScreen.y}) -> e${aimed.id} ${aimed.role} "${aimed.name}"`);
console.log(`wrote ${outDir}/{snapshot.json,overview.png,aim-overview.png,aim-crop.png,aim.json}`);
