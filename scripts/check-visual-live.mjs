#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
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

	const pageHtml = `<!doctype html><html><head><title>Visual Live</title></head>
<body style="font: 24px sans-serif; padding: 48px">
<h1>Visual Live</h1>
<button id="go" style="font-size: 32px; padding: 16px 32px"
 onclick="const n=(window.__clicks=(window.__clicks||0)+1);document.getElementById('result').textContent='clicked '+n;">Zeta Button</button>
<p><input id="seed" value="seed text" style="font-size: 24px; padding: 8px; width: 420px"
 oninput="document.getElementById('seed-echo').textContent='echo: '+this.value;"></p>
<p id="seed-echo" style="font-size: 20px"></p>
<p id="result" style="font-size: 28px">not clicked</p>
<p id="target" style="font-size: 28px">Localized paragraph for zoom checks</p>
</body></html>`;
	const server = http.createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(pageHtml);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const pageUrl = `http://127.0.0.1:${server.address().port}/page.html`;

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-visual-live-"));
	const chromeProfileDir = path.join(tempDir, "desktop-profile");

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

	const { executeAct, executeFind, executeLaunchBrowser, executeObserve, executeZoom, shutdownComputerUseSession } = await import("../src/bridge.ts");
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
			"--user-data-dir=" + chromeProfileDir,
			"--window-size=1024,768",
			pageUrl,
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
		const entry = json.elements.find((element) => element.role === "entry" || element.value !== undefined) ?? json.elements[0];
		assert(entry?.ref, "observation had no actionable ref");
		assert.equal(images(observation).length, 1, "visual mode should attach one annotated overview");
		console.log(`PASS desktop v2 observation: ${json.elements.length} elements, ${json.text.length} text blocks (${stateId})`);

		const zoomed = await tool(executeZoom, { stateId, ref: entry.ref });
		assert.equal(images(zoomed).length, 1, "zoom_ui returned no image");
		assert.match(text(zoomed), /Elements in view:/);
		console.log(`PASS desktop zoom_ui ${entry.ref}`);

		const point = { x: entry.rect[0] + Math.floor(entry.rect[2] / 2), y: entry.rect[1] + Math.floor(entry.rect[3] / 2) };
		const preview = await tool(executeAct, { stateId, actions: [{ action: "aim", x: point.x, y: point.y }] });
		assert.match(text(preview), /Aim preview/);
		assert.match(text(preview), /Nothing was dispatched/);
		assert.equal(images(preview).length, 2, "aim preview should return the crosshair overview and the crop");
		console.log(`PASS desktop aim preview at (${point.x},${point.y}) — nothing dispatched`);

		const committed = await tool(executeAct, { stateId, actions: [{ action: "commit" }] });
		assert.match(text(committed), /Executed 1 checked UI action/);
		const committedState = committed.details?.capture?.stateId;
		assert(committedState, "commit returned no successor state");
		console.log(`PASS desktop commit dispatched the armed click (${committedState})`);

		const refreshed = await tool(executeObserve, { root: root.windowRef, mode: "visual" });
		const refreshedState = refreshed.details?.capture?.stateId;
		assert(refreshedState, "refreshed observation returned no stateId");
		const refreshedJson = JSON.parse(parseJsonBody(text(refreshed)));
		const refreshedTarget = refreshedJson.elements.find((element) => element.rect && element.name) ?? refreshedJson.elements[0];
		const directPoint = {
			x: refreshedTarget.rect[0] + Math.floor(refreshedTarget.rect[2] / 2),
			y: refreshedTarget.rect[1] + Math.floor(refreshedTarget.rect[3] / 2),
		};
		const direct = await tool(executeAct, { stateId: refreshedState, actions: [{ action: "click", x: directPoint.x, y: directPoint.y, confirm: true }] });
		assert.match(text(direct), /Executed 1 checked UI action/);
		console.log("PASS desktop confirm:true dispatched without a preview");

		const textOnly = await tool(executeObserve, { root: root.windowRef, mode: "visual" }, textOnlyCtx);
		assert.match(text(textOnly), /vision-capable model is strongly recommended/);
		assert.equal(images(textOnly).length, 0, "text-only models must not receive images");
		console.log("PASS text-only advisory and image gating");

		const launched = await tool(executeLaunchBrowser, { url: pageUrl });
		const browserRoot = launched.details?.root?.ref;
		assert(browserRoot?.startsWith("@r"), "launch_browser did not return a public @r root");
		const browserObservation = await tool(executeObserve, { root: browserRoot, mode: "visual" });
		const browserState = browserObservation.details?.stateId;
		assert(browserState, "browser observation returned no stateId");
		const browserJson = JSON.parse(parseJsonBody(text(browserObservation)));
		assert.equal(browserJson.state, browserState, "browser observation must echo the stateId");
		assert.ok(browserJson.url?.includes("127.0.0.1"), "browser observation must carry the page URL");
		assert(browserJson.elements.length > 0, "browser observation listed no elements");
		const browserTarget = browserJson.elements.find((element) => element.name === "Zeta Button");
		assert(browserTarget?.rect, "browser elements must carry viewport rects");
		assert.equal(images(browserObservation).length, 1, "visual browser mode should attach one screenshot");
		console.log(`PASS browser v2 observation: ${browserJson.elements.length} elements, ${browserJson.text.length} text blocks (${browserState})`);

		const browserZoom = await tool(executeZoom, { stateId: browserState, ref: browserTarget.ref });
		assert.equal(images(browserZoom).length, 1, "browser zoom_ui returned no image");
		assert.match(text(browserZoom), /viewport px/);
		console.log(`PASS browser zoom_ui ${browserTarget.ref}`);

		const browserInput = browserJson.elements.find((element) => element.value !== undefined || ["textfield", "textbox", "searchfield"].includes(element.role));
		assert(browserInput?.ref, `browser text inputs must be listed as elements: ${JSON.stringify(browserJson.elements)}`);
		console.log(`PASS browser text input listed as ${browserInput.ref}`);

		const typed = await tool(executeAct, { stateId: browserState, actions: [{ action: "setText", ref: browserInput.ref, text: "typed via ref" }] });
		assert.match(text(typed), /act_ui completed for/);
		const refreshedBrowser = await tool(executeObserve, { root: browserRoot, mode: "semantic" });
		const refreshedBrowserState = refreshedBrowser.details?.stateId;
		assert(refreshedBrowserState, "refreshed browser observation returned no stateId");
		const refreshedBrowserJson = JSON.parse(parseJsonBody(text(refreshedBrowser)));
		const refreshedInput = refreshedBrowserJson.elements.find((element) => element.ref === browserInput.ref);
		assert.equal(refreshedInput?.value, "typed via ref", `typing by ref never reached the input: ${JSON.stringify(refreshedBrowserJson.elements)}`);
		assert(refreshedBrowserJson.text.some((block) => block.includes("echo: typed via ref")), `typing by ref never reached the page: ${JSON.stringify(refreshedBrowserJson.text)}`);
		assert.equal(images(refreshedBrowser).length, 0, "semantic browser observations must not attach images");
		console.log("PASS browser setText by ref reached the page");

		const browserButtonTarget = refreshedBrowserJson.elements.find((element) => element.name === "Zeta Button");
		assert(browserButtonTarget?.rect, "refreshed browser elements must carry viewport rects");
		const browserPoint = {
			x: Math.round(browserButtonTarget.rect[0] + browserButtonTarget.rect[2] / 2),
			y: Math.round(browserButtonTarget.rect[1] + browserButtonTarget.rect[3] / 2),
		};
		const browserPreview = await tool(executeAct, { stateId: refreshedBrowserState, actions: [{ action: "aim", x: browserPoint.x, y: browserPoint.y }] });
		assert.match(text(browserPreview), /Aim preview at viewport/);
		assert.match(text(browserPreview), /Nothing was dispatched/);
		assert.equal(images(browserPreview).length, 2, "browser aim preview should return the crosshair overview and the crop");
		console.log(`PASS browser aim preview at (${browserPoint.x},${browserPoint.y}) — nothing dispatched`);

		const browserCommitted = await tool(executeAct, { stateId: refreshedBrowserState, actions: [{ action: "commit" }] });
		assert.match(text(browserCommitted), /act_ui completed for/);
		const browserCommittedState = browserCommitted.details?.stateId;
		assert(browserCommittedState && browserCommittedState !== refreshedBrowserState, "browser commit must advance the state");
		console.log(`PASS browser commit dispatched the armed click (${browserCommittedState})`);

		const afterClick = await tool(executeObserve, { root: browserRoot, mode: "semantic" });
		const afterJson = JSON.parse(parseJsonBody(text(afterClick)));
		assert(afterJson.text.some((block) => block.includes("clicked 1")), `the browser click never reached the page: ${JSON.stringify(afterJson.text)}`);
		assert.equal(images(afterClick).length, 0, "semantic browser observations must not attach images");
		console.log("PASS browser click reached the page (click counter incremented)");

		console.log("PASS live visual E2E: desktop and browser v2 observations, zoom, aim previews, commits, and modality gating");
	} finally {
		await shutdownComputerUseSession().catch(() => {});
		for (const child of processes.reverse()) stop(child);
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve)).catch(() => {});
		await delay(500);
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
