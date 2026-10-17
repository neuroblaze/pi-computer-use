import Jimp from "jimp";
import type { LookResponse, OutlineRect } from "../outline.ts";
import { DEFAULT_MAX_EDGE, badgeLabel, elementAt, type VisualSnapshot } from "./snapshot.ts";

const BLACK = Jimp.rgbaToInt(0, 0, 0, 255);
const WHITE = Jimp.rgbaToInt(255, 255, 255, 255);
const ORANGE = Jimp.rgbaToInt(255, 122, 0, 255);
const RED = Jimp.rgbaToInt(255, 45, 85, 255);
const CYAN = Jimp.rgbaToInt(0, 176, 255, 255);
const GRAY = Jimp.rgbaToInt(158, 158, 158, 255);

type Img = Jimp;
type LoadedFont = Awaited<ReturnType<typeof Jimp.loadFont>>;

let font8Promise: Promise<LoadedFont> | undefined;
let font16Promise: Promise<LoadedFont> | undefined;

function font8(): Promise<LoadedFont> {
	font8Promise ??= Jimp.loadFont(Jimp.FONT_SANS_8_WHITE);
	return font8Promise;
}

function font16(): Promise<LoadedFont> {
	font16Promise ??= Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
	return font16Promise;
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
	for (let y = -Math.ceil(r); y <= Math.ceil(r); y += 1) {
		for (let x = -Math.ceil(r); x <= Math.ceil(r); x += 1) {
			if (x * x + y * y <= r * r) pixel(img, cx + x, cy + y, color);
		}
	}
}

function circleStroke(img: Img, cx: number, cy: number, r: number, color: number): void {
	const steps = Math.max(32, Math.round(r * 8));
	for (let i = 0; i < steps; i += 1) {
		const angle = (i / steps) * Math.PI * 2;
		pixel(img, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, color);
	}
}

function chipText(img: Img, font: LoadedFont, x: number, y: number, text: string, background = BLACK): void {
	const width = Jimp.measureText(font, text);
	const height = Jimp.measureTextHeight(font, text, 10000);
	fillRect(img, x, y, width + 8, height + 4, background);
	img.print(font, x + 4, y + 2, text, 10000);
}

function badge(img: Img, font: LoadedFont, cx: number, cy: number, label: string): void {
	circleFill(img, cx, cy, 11, BLACK);
	circleFill(img, cx, cy, 9, ORANGE);
	const width = Jimp.measureText(font, label);
	const height = Jimp.measureTextHeight(font, label, 10000);
	img.print(font, Math.round(cx - width / 2), Math.round(cy - height / 2), label, 10000);
}

/**
 * The capture a renderer draws on: an image plus the coordinate space the
 * model acts in (screen points for windows, viewport CSS pixels for pages).
 */
export interface CaptureSource {
	origin: [number, number];
	size: [number, number];
	image: { base64: string; mimeType?: string; width: number; height: number };
}

export function captureSourceFromLook(look: LookResponse): CaptureSource | undefined {
	if (!look.image?.jpegBase64) return undefined;
	const frame = look.window.framePoints;
	return {
		origin: [frame.x, frame.y],
		size: [frame.w, frame.h],
		image: { base64: look.image.jpegBase64, mimeType: look.image.mimeType, width: look.image.width, height: look.image.height },
	};
}

async function decodeCapture(source: CaptureSource): Promise<Img> {
	if (!source.image.base64) throw new Error("The observation has no capture image to annotate.");
	return await Jimp.read(Buffer.from(source.image.base64, "base64"));
}

function scaleCapture(capture: Img, maxEdge = DEFAULT_MAX_EDGE): { scale: number; image: Img } {
	const scale = Math.min(1, maxEdge / Math.max(capture.bitmap.width, capture.bitmap.height));
	return { scale, image: capture.clone().scale(scale) };
}

function captureScales(source: CaptureSource): { scaleX: number; scaleY: number } {
	return {
		scaleX: source.image.width / Math.max(1, source.size[0]),
		scaleY: source.image.height / Math.max(1, source.size[1]),
	};
}

function drawRulers(img: Img, font: LoadedFont, originX: number, originY: number, sizeW: number, sizeH: number): void {
	const width = img.bitmap.width;
	const height = img.bitmap.height;
	fillRect(img, 0, 0, width, 14, BLACK);
	fillRect(img, 0, 0, 40, height, BLACK);
	for (let i = 0; i <= 10; i += 1) {
		const x = Math.round((i / 10) * (width - 41)) + 40;
		chipText(img, font, Math.min(x, width - 34), 2, String(Math.round(originX + (i / 10) * sizeW)));
		const y = Math.round((i / 10) * (height - 15)) + 14;
		if (y + 12 < height) chipText(img, font, 2, Math.min(y, height - 14), String(Math.round(originY + (i / 10) * sizeH)));
	}
}

function drawElements(img: Img, font: LoadedFont, snapshot: VisualSnapshot, scale: number): void {
	const clustered = new Set<string>();
	for (const cluster of snapshot.clusters) {
		for (const ref of cluster.refs) clustered.add(ref);
	}
	for (const element of snapshot.elements) {
		if (!element.rect) continue;
		const [x, y, w, h] = element.rect.map((value) => value * scale) as [number, number, number, number];
		strokeRect(img, x, y, Math.max(w, 2), Math.max(h, 2), 4, BLACK);
		strokeRect(img, x, y, Math.max(w, 2), Math.max(h, 2), 2, ORANGE);
		if (clustered.has(element.ref)) continue;
		const badgeY = y - 13 > 16 ? y - 13 : y + 13;
		badge(img, font, x + 11, badgeY, badgeLabel(element.ref));
	}
	for (const cluster of snapshot.clusters) {
		badge(img, font, cluster.at[0] * scale, cluster.at[1] * scale, cluster.id);
	}
}

export interface OverviewOptions {
	/** Render edge; must match the snapshot's cluster maxEdge. */
	maxEdge?: number;
}

export async function renderOverview(source: CaptureSource, snapshot: VisualSnapshot, options: OverviewOptions = {}): Promise<Buffer> {
	const capture = await decodeCapture(source);
	const { scale, image } = scaleCapture(capture, options.maxEdge);
	const [originX, originY] = source.origin;
	const [sizeW, sizeH] = source.size;
	drawRulers(image, await font8(), originX, originY, sizeW, sizeH);
	drawElements(image, await font16(), snapshot, scale);
	return await image.getBufferAsync(Jimp.MIME_PNG);
}

export interface CaptureRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Maps a rect in the source's action coordinates into capture pixels. */
export function rectToCapture(source: CaptureSource, rect: OutlineRect): CaptureRect {
	const [originX, originY] = source.origin;
	const { scaleX, scaleY } = captureScales(source);
	return {
		x: Math.round((rect.x - originX) * scaleX),
		y: Math.round((rect.y - originY) * scaleY),
		w: Math.round(rect.w * scaleX),
		h: Math.round(rect.h * scaleY),
	};
}

export interface CropOptions {
	zoom?: number;
	maxOutput?: number;
	crosshair?: { x: number; y: number };
	caption?: string;
}

/** Native-resolution crop with an action-coordinate graticule; the only place fine guides belong. */
export async function renderCrop(source: CaptureSource, rect: CaptureRect, options: CropOptions = {}): Promise<Buffer> {
	const capture = await decodeCapture(source);
	const captureW = capture.bitmap.width;
	const captureH = capture.bitmap.height;
	const w = Math.max(1, Math.min(Math.round(rect.w), captureW));
	const h = Math.max(1, Math.min(Math.round(rect.h), captureH));
	const x = Math.max(0, Math.min(captureW - w, Math.round(rect.x)));
	const y = Math.max(0, Math.min(captureH - h, Math.round(rect.y)));
	const maxOutput = options.maxOutput ?? 1500;
	const fit = maxOutput / Math.max(w, h);
	const zoom = Math.max(0.1, Math.min(options.zoom ?? Math.min(3, Math.max(1, fit)), fit));
	const crop = capture.clone().crop(x, y, w, h).scale(zoom);
	const cropW = crop.bitmap.width;
	const cropH = crop.bitmap.height;

	const [originX, originY] = source.origin;
	const { scaleX, scaleY } = captureScales(source);
	const minor = await font8();
	for (let step = 0; step <= w; step += 10) {
		if ((x + step) % 50 !== 0) lineV(crop, 0, cropH, step * zoom, GRAY);
	}
	for (let step = 0; step <= h; step += 10) {
		if ((y + step) % 50 !== 0) lineH(crop, 0, cropW, step * zoom, GRAY);
	}
	for (let step = 0; step <= w; step += 50) {
		const px = step * zoom;
		lineV(crop, 0, cropH, px, CYAN);
		chipText(crop, minor, px + 2, 2, String(Math.round(originX + (x + step) / scaleX)), CYAN);
	}
	for (let step = 0; step <= h; step += 50) {
		const py = step * zoom;
		lineH(crop, 0, cropW, py, CYAN);
		chipText(crop, minor, 2, py + 2, String(Math.round(originY + (y + step) / scaleY)), CYAN);
	}
	if (options.crosshair) {
		const crossX = Math.round((options.crosshair.x - x) * zoom);
		const crossY = Math.round((options.crosshair.y - y) * zoom);
		if (crossX >= 0 && crossX < cropW && crossY >= 0 && crossY < cropH) {
			lineH(crop, 0, cropW, crossY, RED);
			lineV(crop, 0, cropH, crossX, RED);
			circleStroke(crop, crossX, crossY, 14, RED);
		}
	}
	if (options.caption) chipText(crop, minor, 2, Math.max(2, cropH - 14), options.caption, BLACK);
	return await crop.getBufferAsync(Jimp.MIME_PNG);
}

export interface AimPreviewOptions extends OverviewOptions {
	/** Native crop size in capture pixels; defaults to 320x240. */
	cropSize?: [number, number];
	zoom?: number;
}

export interface AimPreview {
	overview: Buffer;
	crop: Buffer;
}

/**
 * Renders the aim -> verify preview: annotated overview plus a graticule crop.
 * Nothing is dispatched. The aim point must be in capture pixels (the same
 * space as snapshot element rects); captions convert it back to action
 * coordinates (screen points or viewport pixels) for the model.
 */
export async function renderAimPreview(source: CaptureSource, snapshot: VisualSnapshot, aim: { x: number; y: number }, options: AimPreviewOptions = {}): Promise<AimPreview> {
	const capture = await decodeCapture(source);
	const [originX, originY] = source.origin;
	const { scaleX, scaleY } = captureScales(source);
	const { scale, image } = scaleCapture(capture, options.maxEdge);

	drawRulers(image, await font8(), originX, originY, source.size[0], source.size[1]);
	drawElements(image, await font16(), snapshot, scale);

	const screenX = Math.round(originX + aim.x / scaleX);
	const screenY = Math.round(originY + aim.y / scaleY);
	const under = elementAt(snapshot, aim.x, aim.y)[0];
	const caption = under
		? `aim ${screenX},${screenY} -> ${under.ref} ${under.role}${under.name ? ` "${under.name}"` : ""}`
		: `aim ${screenX},${screenY} -> no element`;
	const crossX = Math.round((aim.x + 0.5) * scale);
	const crossY = Math.round((aim.y + 0.5) * scale);
	lineH(image, 40, image.bitmap.width, crossY, RED);
	lineV(image, 14, image.bitmap.height, crossX, RED);
	circleStroke(image, crossX, crossY, 16, RED);
	chipText(image, await font8(), Math.max(41, crossX + 18), Math.max(15, crossY + 14), caption, RED);
	const overview = await image.getBufferAsync(Jimp.MIME_PNG);

	const [requestedW, requestedH] = options.cropSize ?? [320, 240];
	const crop = await renderCrop(source, {
		x: aim.x - requestedW / 2,
		y: aim.y - requestedH / 2,
		w: requestedW,
		h: requestedH,
	}, { zoom: options.zoom ?? 2.5, crosshair: aim, caption });

	return { overview, crop };
}
