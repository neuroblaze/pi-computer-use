#!/usr/bin/env node
// Blind visual-acuity probe: renders UI-like cards with one target at a random
// position. The answers live in truth.json and must not be read until guesses.json
// exists. See reveal.mjs for the scoring step.
import fs from "node:fs/promises";
import path from "node:path";
import Jimp from "jimp";

const W = 1536;
const H = 864;
const SIZES = [16, 32, 48, 64];
const CARDS = 8;
const RULER_STEP = 128;

const BLACK = Jimp.rgbaToInt(0, 0, 0, 255);
const WHITE = Jimp.rgbaToInt(255, 255, 255, 255);
const BLUE = Jimp.rgbaToInt(24, 119, 242, 255);
const GRAY = Jimp.rgbaToInt(120, 120, 120, 255);
const DARK = Jimp.rgbaToInt(60, 60, 60, 255);
const LIGHT = Jimp.rgbaToInt(243, 243, 243, 255);

function argValue(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pixel(img, x, y, color) {
	x = Math.round(x);
	y = Math.round(y);
	if (x < 0 || y < 0 || x >= img.bitmap.width || y >= img.bitmap.height) return;
	img.setPixelColor(color, x, y);
}

function fillRect(img, x, y, w, h, color) {
	for (let py = Math.round(y); py < Math.round(y + h); py += 1) {
		for (let px = Math.round(x); px < Math.round(x + w); px += 1) pixel(img, px, py, color);
	}
}

function strokeRect(img, x, y, w, h, thickness, color) {
	fillRect(img, x, y, w, thickness, color);
	fillRect(img, x, y + h - thickness, w, thickness, color);
	fillRect(img, x, y, thickness, h, color);
	fillRect(img, x + w - thickness, y, thickness, h, color);
}

function circleFill(img, cx, cy, r, color) {
	for (let y = -Math.ceil(r); y <= Math.ceil(r); y += 1) {
		for (let x = -Math.ceil(r); x <= Math.ceil(r); x += 1) {
			if (x * x + y * y <= r * r) pixel(img, cx + x, cy + y, color);
		}
	}
}

function circleStroke(img, cx, cy, r, thickness, color) {
	for (let ring = 0; ring < thickness; ring += 1) {
		const radius = r - ring;
		const steps = Math.max(32, Math.round(radius * 8));
		for (let i = 0; i < steps; i += 1) {
			const angle = (i / steps) * Math.PI * 2;
			pixel(img, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, color);
		}
	}
}

function chipText(img, font, x, y, text, bg) {
	const w = Jimp.measureText(font, text);
	const h = Jimp.measureTextHeight(font, text, 10000);
	if (bg !== undefined) fillRect(img, x, y, w + 8, h + 4, bg);
	img.print(font, x + 4, y + 2, text, 10000);
}

const outDir = path.resolve(argValue("--out", "spike-out/acuity"));
const seed = Number(argValue("--seed", "7"));

const font8w = await Jimp.loadFont(Jimp.FONT_SANS_8_WHITE);
const font16 = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
const font32 = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

const words = ["Settings", "File", "Edit", "View", "Save changes", "Notifications", "Account", "Recent", "Help", "Search", "Downloads", "General"];

await fs.mkdir(outDir, { recursive: true });
const truth = [];
for (let card = 0; card < CARDS; card += 1) {
	const rand = mulberry32(seed * 1000 + card * 17);
	const d = SIZES[card % SIZES.length];
	const rulers = card >= CARDS / 2;
	const img = new Jimp(W, H, LIGHT);

	fillRect(img, 0, 0, W, 44, WHITE);
	fillRect(img, 0, 43, W, 1, DARK);
	chipText(img, font16, 12, 12, "File   Edit   View   Window   Help", BLACK);
	chipText(img, font16, W - 160, 12, "user@host", BLACK);

	for (let block = 0; block < 6; block += 1) {
		const bw = 180 + Math.round(rand() * 260);
		const bh = 90 + Math.round(rand() * 130);
		const bx = 60 + Math.round(rand() * (W - bw - 120));
		const by = 70 + Math.round(rand() * (H - bh - 140));
		fillRect(img, bx, by, bw, bh, WHITE);
		strokeRect(img, bx, by, bw, bh, 1, GRAY);
		chipText(img, rand() < 0.5 ? font16 : font32, bx + 10, by + 8, words[Math.floor(rand() * words.length)], BLACK);
		if (rand() < 0.7) chipText(img, font16, bx + 10, by + bh - 30, words[Math.floor(rand() * words.length)], GRAY);
	}

	const cx = 110 + Math.round(rand() * (W - 220));
	const cy = 90 + Math.round(rand() * (H - 180));
	circleFill(img, cx, cy, d / 2, BLUE);
	circleStroke(img, cx, cy, d / 2 - 2, 2, WHITE);

	for (let decoy = 0; decoy < 3; decoy += 1) {
		let dx = 0;
		let dy = 0;
		do {
			dx = 90 + Math.round(rand() * (W - 180));
			dy = 80 + Math.round(rand() * (H - 160));
		} while (Math.hypot(dx - cx, dy - cy) < d * 2.5);
		circleStroke(img, dx, dy, 5 + Math.round(rand() * 5), 2, GRAY);
	}

	if (rulers) {
		fillRect(img, 0, 0, W, 16, BLACK);
		fillRect(img, 0, 0, 46, H, BLACK);
		for (let x = 0; x <= W - RULER_STEP; x += RULER_STEP) {
			const label = String(Math.round(x + RULER_STEP));
			chipText(img, font8w, Math.min(x + RULER_STEP - 14, W - 40), 3, label, WHITE, BLACK);
		}
		for (let y = 0; y <= H - RULER_STEP; y += RULER_STEP) {
			const label = String(Math.round(y + RULER_STEP));
			chipText(img, font8w, 3, Math.min(y + RULER_STEP - 8, H - 14), label, WHITE, BLACK);
		}
	}

	await img.writeAsync(path.join(outDir, `card-0${card + 1}.png`));
	truth.push({ card: card + 1, cx, cy, d, rulers });
}
await fs.writeFile(path.join(outDir, "truth.json"), `${JSON.stringify(truth, null, 2)}\n`);
console.log(`wrote ${CARDS} cards to ${outDir} (truth withheld until guesses.json exists)`);
