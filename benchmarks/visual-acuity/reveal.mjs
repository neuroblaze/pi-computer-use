#!/usr/bin/env node
// Scores guesses.json against truth.json for the visual-acuity probe.
import fs from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "spike-out/acuity");
const truth = JSON.parse(await fs.readFile(path.join(dir, "truth.json"), "utf8"));
const guesses = JSON.parse(await fs.readFile(path.join(dir, "guesses.json"), "utf8"));

const rows = [];
for (const t of truth) {
	const g = guesses[String(t.card)];
	if (!g) throw new Error(`guesses.json is missing card ${t.card}`);
	const err = Math.hypot(g.x - t.cx, g.y - t.cy);
	rows.push({ ...t, gx: g.x, gy: g.y, err, hit: err <= t.d / 2 });
}

console.log("card  d   rulers  guess        truth        err(px)  err(%W)  hit");
for (const r of rows) {
	console.log(
		`${String(r.card).padStart(4)}  ${String(r.d).padEnd(3)} ${r.rulers ? "yes" : " no"}    ` +
		`(${String(r.gx).padStart(4)},${String(r.gy).padStart(4)})  (${String(r.cx).padStart(4)},${String(r.cy).padStart(4)})  ` +
		`${r.err.toFixed(1).padStart(7)}  ${((r.err / 1536) * 100).toFixed(2).padStart(7)}  ${r.hit ? "yes" : "no"}`,
	);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const all = rows.map((r) => r.err);

console.log("");
console.log(`overall: mean ${mean(all).toFixed(1)}px  median ${median(all).toFixed(1)}px  (card is 1536 wide; x1.25 for a 1920 screen)`);
for (const d of [...new Set(rows.map((r) => r.d))].sort((a, b) => a - b)) {
	const set = rows.filter((r) => r.d === d);
	console.log(`  d=${d}: mean ${mean(set.map((r) => r.err)).toFixed(1)}px  hit-rate ${set.filter((r) => r.hit).length}/${set.length}`);
}
const rulered = rows.filter((r) => r.rulers);
const bare = rows.filter((r) => !r.rulers);
console.log(`rulers: mean ${mean(rulered.map((r) => r.err)).toFixed(1)}px over ${rulered.length}  |  bare: mean ${mean(bare.map((r) => r.err)).toFixed(1)}px over ${bare.length}`);
console.log(`screen-space equivalent (1920-wide display): mean ${(mean(all) * 1.25).toFixed(1)}px  median ${(median(all) * 1.25).toFixed(1)}px`);
