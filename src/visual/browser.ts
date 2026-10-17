import type { CdpPageSnapshot } from "../cdp.ts";
import { restoreOutline } from "../outline.ts";
import type { CaptureSource } from "./overlays.ts";
import { buildSnapshot, type SnapshotOptions, type VisualSnapshot } from "./snapshot.ts";

/** Browser pages render against a viewport screenshot; viewport CSS pixels are the action space. */
export function browserCaptureSource(browser: CdpPageSnapshot): CaptureSource | undefined {
	if (!browser.image) return undefined;
	return {
		screenOrigin: [0, 0],
		size: [browser.viewport.width, browser.viewport.height],
		image: {
			base64: browser.image.base64,
			mimeType: browser.image.mimeType,
			width: browser.image.width,
			height: browser.image.height,
		},
	};
}

/** Builds the v2 observation for a CDP page snapshot: same schema as desktop looks. */
export function buildBrowserSnapshot(browser: CdpPageSnapshot, options: SnapshotOptions & { app?: string } = {}): VisualSnapshot {
	return buildSnapshot({
		app: options.app ?? "Browser",
		title: browser.title,
		url: browser.url,
		screenOrigin: [0, 0],
		size: [browser.viewport.width, browser.viewport.height],
		capture: browser.image ? { width: browser.image.width, height: browser.image.height } : undefined,
		text: browser.text,
		nodes: restoreOutline(browser.outline).nodes,
	}, options);
}
