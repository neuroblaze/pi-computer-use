#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.PI_CU_LIVE !== "1") {
	throw new Error("Live visual E2E is disabled. Set PI_CU_LIVE=1 to run it explicitly.");
}
if (process.platform !== "linux") throw new Error("Live visual E2E requires Linux.");

const scriptPath = fileURLToPath(import.meta.url);

if (!process.argv.includes("--inside-session")) {
	const child = spawn("dbus-run-session", ["--", process.execPath, "--import", "tsx", scriptPath, "--inside-session"], {
		env: { ...process.env, PI_COMPUTER_USE_HEADLESS: "1", PI_COMPUTER_USE_BROWSER_USE: "1" },
		stdio: "inherit",
	});
	const code = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (exitCode, signal) => signal ? reject(new Error(`Live visual E2E session exited on ${signal}.`)) : resolve(exitCode ?? 1));
	});
	process.exitCode = code;
} else {
	await runInsideSession();
}

async function runInsideSession() {
	await fs.access("/usr/bin/Xvfb", fsConstants.X_OK);
	const chromium = await firstExecutable([
		process.env.PI_COMPUTER_USE_CHROME_EXECUTABLE,
		"/usr/local/bin/chromium",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/usr/bin/google-chrome",
	].filter(Boolean));
	if (!chromium) throw new Error("No Chromium binary was found for the live visual E2E.");
	const wm = await firstExecutable(["/usr/bin/xfwm4", "/usr/bin/openbox"]);
	const atspiLauncher = await firstExecutable(["/usr/libexec/at-spi-bus-launcher", "/usr/lib/at-spi2-core/at-spi-bus-launcher"]);

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-visual-live-"));
	const pagePath = path.join(tempDir, "page.html");
	await fs.writeFile(pagePath, `<!doctype html><html><head><title>Visual Live</title></head><body style="font: 24px sans-serif; padding: 48px">
<h1>Visual Live</h1><button id="go" style="font-size: 32px; padding: 16px 32px">Zeta Button</button>
<p><input id="seed" value="seed text" style="font-size: 24px; padding: 8px; width: 420px"></p>
<p id="target" style="font-size: 28px">Localized paragraph for zoom checks</p></body></html>`);

	const display = await unusedDisplay();
	const env = {
		...process.env,
		DISPLAY: display,
		NO_AT_BRIDGE: "0",
		GTK_MODULES: process.env.GTK_MODULES ? `${process.env.GTK_MODULES}:gail:atk-bridge` : "gail:atk-bridge",
		PI_COMPUTER_USE_HEADLESS: "1",
		PI_COMPUTER_USE_BROWSER_USE: "1",
	};
	Object.assign(process.env, env);
	const processes = [];

	const { executeAct, executeFind, executeObserve, executeZoom, shutdownComputerUseSession } = await import("../src/bridge.ts");
	const visionCtx = { cwd: process.cwd(), sessionManager: { getBranch: () => [] }, model: { input: ["text", "image"] } };
	const textOnlyCtx = { ...visionCtx, model: { input: ["text"] } };
	let calls = 0;
	const tool = async (executor, params, ctx = visionCtx) => await executor(`visual-live-${++calls}`, params, undefined, undefined, ctx);
	const text = (result) => result.content.find((item) => item.type === "text")?.text ?? "";
	const images = (result) => result.content.filter((item) => item.type === "image");

	try {
		processes.push(start("/usr/bin/Xvfb", [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-ac"], env));
		await waitFor(() => fs.access(`/tmp/.X11-unix/X${display.slice(1)}`).then(() => true, () => false), "Xvfb socket");
		if (atspiLauncher) processes.push(start(atspiLauncher, ["--launch-immediately", "--a11y=1"], env));
		if (wm) processes.push(start(wm, wm.endsWith("openbox") ? [] : ["--replace", "--compositor=off"], env));
		await delay(750);

		processes.push(start(chromium, [
			"--no-sandbox",
			"--disable-gpu",
			"--disable-dev-shm-usage",
			"--force-renderer-accessibility",
			"--window-size=1024,768",
			`file://${pagePath}`,
		], env));
		const root = await waitForRoot(tool, executeFind, (candidate) => /visual live/i.test(candidate.windowTitle), 30_000);
		assert(root?.windowRef?.startsWith("@r"), "root did not have a public @r ref");
		console.log(`PASS found ${root.windowRef} ${root.app} — ${root.windowTitle}`);

		const observation = await tool(executeObserve, { root: root.windowRef, mode: "visual" });
		const stateId = observation.details?.capture?.stateId;
		assert(stateId, "visual observation returned no stateId");
		const json = JSON.parse(parseJsonBody(text(observation)));
		assert.equal(json.state, stateId, "observation must echo the stateId");
		assert(json.elements.length > 0, "observation listed no elements");
		assert(json.elements.every((element) => /^@e\d+$/.test(element.ref)), "elements must carry @e refs");
		const target = json.elements.find((element) => element.name === "Zeta Button")
			?? json.elements.find((element) => element.focused || element.value !== undefined && element.name)
			?? json.elements[0];
		assert(target?.ref, "observation had no actionable ref");
		assert.equal(images(observation).length, 1, "visual mode should attach one annotated overview");
		console.log(`PASS v2 observation: ${json.elements.length} elements, ${json.text.length} text blocks (${stateId})`);

		const zoomed = await tool(executeZoom, { stateId, ref: target.ref });
		assert.equal(images(zoomed).length, 1, "zoom_ui returned no image");
		assert.match(text(zoomed), /Elements in view:/);
		console.log(`PASS zoom_ui ${target.ref}`);

		const point = { x: target.rect[0] + Math.floor(target.rect[2] / 2), y: target.rect[1] + Math.floor(target.rect[3] / 2) };
		const preview = await tool(executeAct, { stateId, actions: [{ action: "aim", x: point.x, y: point.y }] });
		assert.match(text(preview), /Aim preview/);
		assert.match(text(preview), /Nothing was dispatched/);
		assert.equal(images(preview).length, 2, "aim preview should return the crosshair overview and the crop");
		console.log(`PASS aim preview at (${point.x},${point.y}) — nothing dispatched`);

		const committed = await tool(executeAct, { stateId, actions: [{ action: "commit" }] });
		assert.match(text(committed), /Executed 1 checked UI action/);
		const committedState = committed.details?.capture?.stateId;
		assert(committedState, "commit returned no successor state");
		console.log(`PASS commit dispatched the armed click (${committedState})`);

		const direct = await tool(executeAct, { stateId: committedState, actions: [{ action: "click", x: point.x, y: point.y, confirm: true }] });
		assert.match(text(direct), /Executed 1 checked UI action/);
		console.log("PASS confirm:true dispatched without a preview");

		const textOnly = await tool(executeObserve, { root: root.windowRef, mode: "visual" }, textOnlyCtx);
		assert.match(text(textOnly), /vision-capable model is strongly recommended/);
		assert.equal(images(textOnly).length, 0, "text-only models must not receive images");
		console.log("PASS text-only advisory and image gating");

		console.log("PASS live visual E2E: v2 observation, zoom, aim preview, commit, and modality gating");
	} finally {
		await shutdownComputerUseSession().catch(() => {});
		for (const child of processes.reverse()) stop(child);
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

function parseJsonBody(body) {
	return body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1);
}

function start(command, args, env) {
	const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"], detached: true });
	child.stderr.on("data", (chunk) => {
		if (process.env.PI_CU_LIVE_DEBUG === "1") process.stderr.write(chunk);
	});
	return child;
}

function stop(child) {
	if (child.exitCode !== null) return;
	try { process.kill(-child.pid, "SIGTERM"); } catch {}
}

async function firstExecutable(paths) {
	for (const candidate of paths) {
		try {
			await fs.access(candidate, fsConstants.X_OK);
			return candidate;
		} catch {}
	}
	return undefined;
}

async function unusedDisplay() {
	for (let number = 90; number < 120; number += 1) {
		try {
			await fs.access(`/tmp/.X11-unix/X${number}`);
		} catch {
			return `:${number}`;
		}
	}
	throw new Error("No unused X11 display was available in :90..:119.");
}

async function rootsFrom(tool, executeFind) {
	return (await tool(executeFind, {})).details?.windows ?? [];
}

async function waitForRoot(tool, executeFind, predicate, timeoutMs = 15_000) {
	return await waitFor(async () => (await rootsFrom(tool, executeFind)).find(predicate), "accessible root", timeoutMs);
}

async function waitFor(check, label, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	let lastError;
	while (Date.now() < deadline) {
		try {
			const value = await check();
			if (value) return value;
		} catch (error) {
			lastError = error;
		}
		await delay(150);
	}
	throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ""}`);
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
