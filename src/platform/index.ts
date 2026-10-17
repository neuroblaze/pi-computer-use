import { linuxBackend } from "./linux/backend.ts";
import type { ComputerUsePlatformBackend } from "./types.ts";

class UnsupportedPlatformBackend implements ComputerUsePlatformBackend {
	readonly name = "linux" as const;
	private readonly platform: NodeJS.Platform;

	constructor(platform: NodeJS.Platform) {
		this.platform = platform;
	}

	private unsupported(): never {
		throw new Error(`This fork supports Linux only; platform '${this.platform}' is not supported.`);
	}

	async ensureReady(): Promise<never> { this.unsupported(); }
	async listApps(): Promise<never> { this.unsupported(); }
	async listRoots(): Promise<never> { this.unsupported(); }
	async getFrontmost(): Promise<never> { this.unsupported(); }
	async focusWindow(): Promise<never> { this.unsupported(); }
	async observe(): Promise<never> { this.unsupported(); }
	async act(): Promise<never> { this.unsupported(); }
	async readText(): Promise<never> { this.unsupported(); }
	async waitFor(): Promise<never> { this.unsupported(); }
	isBrowserApp(): never { this.unsupported(); }
	isChromeFamilyApp(): never { this.unsupported(); }
	async openBrowserLocation(): Promise<boolean> { this.unsupported(); }
}

export function platformBackendForRuntime(platform: NodeJS.Platform = process.platform): ComputerUsePlatformBackend {
	if (platform === "linux") return linuxBackend;
	return new UnsupportedPlatformBackend(platform);
}

export const currentPlatformBackend = platformBackendForRuntime();
