#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const linuxCrateDir = path.join(rootDir, "native", "linux", "bridge-rs");
const linuxTargets = { x64: "x86_64-unknown-linux-gnu", arm64: "aarch64-unknown-linux-gnu" };

function getArg(name) {
	const index = process.argv.indexOf(name);
	if (index >= 0 && index + 1 < process.argv.length) {
		return process.argv[index + 1];
	}
	return undefined;
}

function normalizeArch(arch) {
	if (arch === "all") return arch;
	if (arch === "arm64" || arch === "x64") return arch;
	throw new Error(`Unsupported architecture '${arch}'. Supported: arm64, x64, all.`);
}

async function run(command, args) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
		});
	});
}

function linuxBinaryPath(crateDir, target) {
	const targetDir = target ? path.join("target", target) : "target";
	return path.join(crateDir, targetDir, "release", "linux-bridge");
}

function defaultLinuxOutputPath(arch) {
	return path.join(rootDir, "prebuilt", "linux", arch, "linux-bridge");
}

async function buildLinuxForArch(arch, outputPath) {
	const explicitTarget = getArg("--target");
	if (explicitTarget && !explicitTarget.includes("linux")) throw new Error(`Linux builds require a Linux --target triple, got ${explicitTarget}.`);
	const target = explicitTarget ?? (process.platform === "linux" && process.arch === arch ? undefined : linuxTargets[arch]);
	console.log(`Building Linux helper for ${arch} with cargo...`);
	const cargoArgs = ["build", "--release", "--manifest-path", path.join(linuxCrateDir, "Cargo.toml")];
	if (target) cargoArgs.push("--target", target);
	await run("cargo", cargoArgs);
	const cargoOutput = linuxBinaryPath(linuxCrateDir, target);
	const header = await fs.readFile(cargoOutput).then((data) => data.subarray(0, 20));
	if (header.length < 20 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error(`Cargo output is not a Linux ELF executable: ${cargoOutput}`);
	const machine = header.readUInt16LE(18);
	const expectedMachine = arch === "x64" ? 0x3e : 0xb7;
	if (machine !== expectedMachine) throw new Error(`Cargo output architecture does not match ${arch}: ${cargoOutput}`);
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.copyFile(cargoOutput, outputPath);
	await fs.chmod(outputPath, 0o755);
	console.log(`Built Linux helper at ${outputPath}`);
}

async function buildLinuxHelper() {
	const arch = normalizeArch(getArg("--arch") ?? process.arch);
	const outputArg = getArg("--output");
	if (arch === "all") {
		if (outputArg) throw new Error("--output is not supported with --arch all. Use a single architecture for one output.");
		for (const nextArch of ["x64", "arm64"]) await buildLinuxForArch(nextArch, defaultLinuxOutputPath(nextArch));
		return;
	}
	await buildLinuxForArch(arch, outputArg ? path.resolve(process.cwd(), outputArg) : defaultLinuxOutputPath(arch));
}

async function main() {
	const explicitPlatform = getArg("--platform");
	if (explicitPlatform && explicitPlatform !== "linux") {
		throw new Error(`This fork builds the Linux helper only; got --platform ${explicitPlatform}.`);
	}
	if (process.platform !== "linux") {
		throw new Error(`The Linux helper must be built on Linux; got platform ${process.platform}.`);
	}
	await buildLinuxHelper();
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
