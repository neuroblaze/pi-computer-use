#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const linuxCrateDir = path.join(rootDir, "native", "linux", "bridge-rs");
const linuxHelperDestPath = process.env.PI_COMPUTER_USE_LINUX_HELPER_PATH || path.join(os.homedir(), ".pi", "agent", "helpers", "pi-computer-use", "linux-bridge");

const args = new Set(process.argv.slice(2));
const isPostinstall = args.has("--postinstall");
const allowLinuxBuildFallback = args.has("--allow-build") || process.env.PI_COMPUTER_USE_ALLOW_BUILD === "1";

function getArg(name) {
	const index = process.argv.indexOf(name);
	if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1];
	return undefined;
}

function normalizeArch(arch) {
	if (arch === "arm64" || arch === "x64") return arch;
	throw new Error(`Unsupported architecture '${arch}'. Supported: arm64, x64.`);
}

async function exists(filePath) {
	try {
		await fs.access(filePath, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function hashFile(filePath) {
	const data = await fs.readFile(filePath);
	return createHash("sha256").update(data).digest("hex");
}

async function copyIfChanged(sourcePath, destinationPath) {
	const destinationExists = await exists(destinationPath);
	if (destinationExists) {
		const [sourceHash, destinationHash] = await Promise.all([hashFile(sourcePath), hashFile(destinationPath)]);
		if (sourceHash === destinationHash) {
			await fs.chmod(destinationPath, 0o755);
			return { changed: false };
		}
	}

	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	const tempPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
	await fs.copyFile(sourcePath, tempPath);
	await fs.chmod(tempPath, 0o755);
	try {
		await fs.rename(tempPath, destinationPath);
	} catch (err) {
		await fs.rm(tempPath, { force: true }).catch(() => {});
		if (err.code === "EPERM") {
			throw new Error(`Cannot update helper at ${destinationPath} — the existing helper process is still running. Close the helper process and re-run this script.`);
		}
		throw err;
	}
	return { changed: true };
}

async function run(command, commandArgs) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, commandArgs, { stdio: "inherit" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`Command failed (${code}): ${command} ${commandArgs.join(" ")}`));
		});
	});
}

async function setupLinuxHelper() {
	const arch = normalizeArch(process.arch);
	const prebuiltPath = path.join(rootDir, "prebuilt", "linux", arch, "linux-bridge");
	if (await exists(prebuiltPath)) {
		const { changed } = await copyIfChanged(prebuiltPath, linuxHelperDestPath);
		console.log(changed ? `[pi-computer-use] installed Linux helper (${arch}) from prebuilt to ${linuxHelperDestPath}` : `[pi-computer-use] Linux helper already up to date at ${linuxHelperDestPath}`);
		return;
	}
	if (allowLinuxBuildFallback) {
		if (process.platform !== "linux") throw new Error("The Linux helper source fallback must be built on Linux.");
		console.log("[pi-computer-use] Linux prebuilt helper missing; attempting source build with cargo...");
		await run("cargo", ["build", "--release", "--manifest-path", path.join(linuxCrateDir, "Cargo.toml")]);
		const cargoOutput = path.join(linuxCrateDir, "target", "release", "linux-bridge");
		const { changed } = await copyIfChanged(cargoOutput, linuxHelperDestPath);
		console.log(changed ? `[pi-computer-use] built and installed Linux helper at ${linuxHelperDestPath}` : `[pi-computer-use] Linux helper already up to date at ${linuxHelperDestPath}`);
		return;
	}
	throw new Error(`No Linux prebuilt helper found for ${arch} at ${prebuiltPath}. Run node scripts/build-native.mjs --platform linux to build, or set PI_COMPUTER_USE_ALLOW_BUILD=1 to build at install time.`);
}

async function setup() {
	const explicitPlatform = getArg("--platform");
	if (explicitPlatform && explicitPlatform !== "linux") {
		throw new Error(`This fork installs the Linux helper only; got --platform ${explicitPlatform}.`);
	}
	if (process.platform !== "linux") {
		if (isPostinstall) {
			console.warn("[pi-computer-use] skipping helper setup: platform is not Linux.");
			return;
		}
		throw new Error(`The Linux helper can only be installed on Linux; got platform ${process.platform}.`);
	}
	await setupLinuxHelper();
}

const isMain = process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) setup().catch((error) => {
	if (isPostinstall) {
		console.warn(`[pi-computer-use] postinstall helper setup skipped: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(0);
	}

	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
