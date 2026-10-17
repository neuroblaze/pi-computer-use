import type { LookResponse, OutlineNode } from "../outline.ts";

const INTERACTIVE_ROLES = new Set([
	"push button", "button", "toggle button", "togglebutton", "link", "entry", "textbox",
	"checkbox", "check box", "radio button", "radiobutton", "combo box", "comboboxselect",
	"menu item", "menuitem", "check menu item", "radio menu item", "tab", "slider",
	"spin button", "textfield", "searchfield", "switch", "disclosuretriangle", "menulistoption",
]);
const TEXT_ROLES = new Set(["static", "paragraph", "heading", "label", "caption", "text"]);

export const DEFAULT_MAX_EDGE = 1536;
export const DEFAULT_CLUSTER_DISTANCE = 22;
const DEFAULT_MAX_TEXT_BLOCKS = 40;
const DEFAULT_MAX_TEXT_CHARS = 2000;
const DEFAULT_MAX_BLOCK_CHARS = 300;
const BADGE_OFFSET_X = 11;
const BADGE_OFFSET_Y = 13;

export interface VisualElement {
	ref: string;
	role: string;
	name: string;
	value?: string;
	/** Capture-relative pixels; absent when the platform has no geometry for the element. */
	rect?: [number, number, number, number];
	actions: string[];
	focused?: boolean;
}

export interface VisualCluster {
	id: string;
	at: [number, number];
	refs: string[];
}

export interface VisualSnapshot {
	window: {
		app: string;
		title: string;
		url?: string;
		/** Origin of the capture in the coordinate space the model acts in. */
		screen: [number, number];
		/** Size in that coordinate space (screen points or viewport CSS pixels). */
		size: [number, number];
		capture: [number, number];
	};
	elements: VisualElement[];
	clusters: VisualCluster[];
	text: string[];
	truncated: { text: boolean };
}

/**
 * Platform-neutral observation source. Desktop looks and browser pages both
 * reduce to this: a coordinate space for the capture (origin + size), an
 * optional capture in pixels, and outline nodes whose rects are already
 * relative to the capture origin (window-relative for desktop looks,
 * viewport-relative for pages).
 */
export interface VisualSource {
	app: string;
	title: string;
	url?: string;
	/** Where the capture sits on the physical screen; used for coordinate labels only. */
	screenOrigin: [number, number];
	size: [number, number];
	capture?: { width: number; height: number };
	/** Raw page text; when present it replaces node-derived text blocks (browser pages). */
	text?: string;
	nodes: OutlineNode[];
}

export interface SnapshotOptions {
	/** Render edge used for cluster distances; the renderer uses the same value. */
	maxEdge?: number;
	/** Distance between badge anchors, at render scale, below which elements cluster. */
	clusterDistance?: number;
	maxTextBlocks?: number;
	maxTextChars?: number;
}

/** Badge label for an element: `@e12` renders as `12` so the image and act_ui refs agree. */
export function badgeLabel(ref: string): string {
	const match = /^@?e(\d+)$/.exec(ref);
	return match ? match[1] : ref.slice(0, 3);
}

function sanitizeName(node: OutlineNode): string {
	const raw = [node.title, node.description].map((value) => (value ?? "").trim()).find(Boolean) ?? "";
	if (!raw) return "";
	if (/^[\uFFFC\s]+$/.test(raw)) return "";
	if (raw.startsWith("/org/") || raw.includes("/org/a11y/")) return "";
	return raw;
}

function cleanValue(value: string | undefined): string {
	return (value ?? "").replace(/\uFFFC/g, "").trim();
}

function normalizeRole(role: string | undefined): string {
	return (role ?? "").replace(/^AX/, "").toLowerCase();
}

/** Splits raw page text into paragraph-ish blocks, collapsing whitespace. */
export function textBlocksFromPage(text: string, maxBlockChars = DEFAULT_MAX_BLOCK_CHARS): string[] {
	const paragraphs = text.split(/\n\s*\n/);
	const source = paragraphs.length > 1 ? paragraphs : text.split("\n");
	const blocks: string[] = [];
	for (const raw of source) {
		const block = raw.replace(/\s+/g, " ").trim();
		if (!block || blocks[blocks.length - 1] === block) continue;
		blocks.push(block.length > maxBlockChars ? `${block.slice(0, maxBlockChars)}…` : block);
	}
	return blocks;
}

/** Caps text blocks by count and total characters, reporting truncation. */
export function capTextBlocks(blocks: string[], options: SnapshotOptions = {}): { text: string[]; truncated: boolean } {
	const maxBlocks = options.maxTextBlocks ?? DEFAULT_MAX_TEXT_BLOCKS;
	const maxChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
	const text: string[] = [];
	let chars = 0;
	let truncated = false;
	for (const block of blocks) {
		if (text.length >= maxBlocks || chars >= maxChars) {
			truncated = true;
			break;
		}
		const remaining = maxChars - chars;
		if (block.length > remaining) {
			text.push(block.slice(0, remaining));
			truncated = true;
			break;
		}
		text.push(block);
		chars += block.length;
	}
	return { text, truncated };
}

export function buildSnapshot(source: VisualSource, options: SnapshotOptions = {}): VisualSnapshot {
	const [originX, originY] = source.screenOrigin;
	const [sizeW, sizeH] = source.size;
	const captureW = Math.max(1, Math.round(source.capture?.width ?? sizeW));
	const captureH = Math.max(1, Math.round(source.capture?.height ?? sizeH));
	const scaleX = captureW / Math.max(1, sizeW);
	const scaleY = captureH / Math.max(1, sizeH);
	const renderScale = Math.min(1, (options.maxEdge ?? DEFAULT_MAX_EDGE) / Math.max(captureW, captureH));
	const frameArea = Math.max(1, sizeW * sizeH);

	// Node rects are already relative to the capture origin, so they only need
	// scaling; the screen origin matters for labels, not for geometry.
	const visibleRect = (node: OutlineNode): [number, number, number, number] | undefined => {
		if (!node.rect) return undefined;
		const x = node.rect.x * scaleX;
		const y = node.rect.y * scaleY;
		const w = node.rect.w * scaleX;
		const h = node.rect.h * scaleY;
		if (x + w <= 0 || y + h <= 0 || x >= captureW || y >= captureH) return undefined;
		return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
	};

	const interactive = source.nodes.filter((node) => {
		if (!node.ref || node.offscreen) return false;
		if (node.rect) {
			if (!visibleRect(node)) return false;
			if (node.rect.w * node.rect.h > 0.6 * frameArea) return false;
		}
		const role = normalizeRole(node.role);
		if (!(INTERACTIVE_ROLES.has(role) || node.isTextInput || node.canSetValue)) return false;
		return Boolean(sanitizeName(node) || cleanValue(node.value) || node.isTextInput);
	});

	const seen = new Set<string>();
	const elements: VisualElement[] = [];
	for (const node of interactive) {
		const rect = visibleRect(node);
		const duplicateKey = `${node.role}|${sanitizeName(node)}|${rect ? rect.join(",") : "none"}`;
		if (seen.has(duplicateKey)) continue;
		seen.add(duplicateKey);
		elements.push({
			ref: node.ref,
			role: normalizeRole(node.role),
			name: sanitizeName(node),
			value: cleanValue(node.value) || undefined,
			rect,
			actions: node.actions ?? [],
			focused: node.focused || undefined,
		});
	}

	const badgeAnchor = (element: VisualElement): [number, number] => {
		const [x, y] = element.rect!;
		const anchorX = x * renderScale + BADGE_OFFSET_X;
		const anchorY = y * renderScale - BADGE_OFFSET_Y > 16 ? y * renderScale - BADGE_OFFSET_Y : y * renderScale + BADGE_OFFSET_Y;
		return [anchorX, anchorY];
	};
	const positioned = elements.filter((element): element is VisualElement & { rect: [number, number, number, number] } => Boolean(element.rect));
	const anchors = new Map<string, [number, number]>(positioned.map((element) => [element.ref, badgeAnchor(element)]));
	const distance = options.clusterDistance ?? DEFAULT_CLUSTER_DISTANCE;
	const parent = new Map<string, string>(positioned.map((element) => [element.ref, element.ref]));
	const find = (ref: string): string => {
		let root = ref;
		while (parent.get(root)! !== root) root = parent.get(root)!;
		return root;
	};
	for (let i = 0; i < positioned.length; i += 1) {
		for (let j = i + 1; j < positioned.length; j += 1) {
			const [ax, ay] = anchors.get(positioned[i].ref)!;
			const [bx, by] = anchors.get(positioned[j].ref)!;
			if ((ax - bx) ** 2 + (ay - by) ** 2 <= distance * distance) {
				const ra = find(positioned[i].ref);
				const rb = find(positioned[j].ref);
				if (ra !== rb) parent.set(rb, ra);
			}
		}
	}
	const groups = new Map<string, string[]>();
	for (const element of positioned) {
		const root = find(element.ref);
		const group = groups.get(root);
		if (group) group.push(element.ref);
		else groups.set(root, [element.ref]);
	}
	const clusters: VisualCluster[] = [];
	for (const refs of groups.values()) {
		if (refs.length < 2) continue;
		const xs = refs.map((ref) => anchors.get(ref)![0]);
		const ys = refs.map((ref) => anchors.get(ref)![1]);
		const at: [number, number] = [
			Math.round(xs.reduce((a, b) => a + b, 0) / refs.length / renderScale),
			Math.round(ys.reduce((a, b) => a + b, 0) / refs.length / renderScale),
		];
		clusters.push({ id: `C${clusters.length + 1}`, at, refs });
	}

	const title = source.title.trim();
	let capped: { text: string[]; truncated: boolean };
	if (source.text !== undefined) {
		capped = capTextBlocks(textBlocksFromPage(source.text), options);
	} else {
		const blocks: string[] = [];
		for (const node of source.nodes) {
			if (!TEXT_ROLES.has(normalizeRole(node.role))) continue;
			if (node.rect && !visibleRect(node)) continue;
			const block = cleanValue(node.value) || sanitizeName(node);
			if (!block || block === title) continue;
			if (blocks[blocks.length - 1] === block) continue;
			blocks.push(block);
		}
		capped = capTextBlocks(blocks, options);
	}

	return {
		window: {
			app: source.app,
			title,
			url: source.url,
			screen: [Math.round(originX), Math.round(originY)],
			size: [Math.round(sizeW), Math.round(sizeH)],
			capture: [captureW, captureH],
		},
		elements,
		clusters,
		text: capped.text,
		truncated: { text: capped.truncated },
	};
}

/** Desktop adapter: AT-SPI look responses map window-relative node rects through the capture scale. */
export function buildVisualSnapshot(look: LookResponse, options: SnapshotOptions & { app?: string } = {}): VisualSnapshot {
	const frame = look.window.framePoints;
	return buildSnapshot({
		app: options.app ?? "",
		title: look.outline.title,
		screenOrigin: [frame.x, frame.y],
		size: [frame.w, frame.h],
		capture: look.image ? { width: look.image.width, height: look.image.height } : undefined,
		nodes: look.parsedOutline?.nodes ?? [],
	}, options);
}

/** Elements containing a point in the source's action coordinates. */
export function elementAt(snapshot: VisualSnapshot, x: number, y: number): VisualElement[] {
	return snapshot.elements.filter((element) => element.rect
		&& x >= element.rect[0] && x < element.rect[0] + element.rect[2]
		&& y >= element.rect[1] && y < element.rect[1] + element.rect[3]);
}

/** One line per cluster, listing the member refs so they stay clickable. */
export function describeClusters(snapshot: VisualSnapshot): string[] {
	const byRef = new Map(snapshot.elements.map((element) => [element.ref, element]));
	return snapshot.clusters.map((cluster) => {
		const members = cluster.refs
			.map((ref) => byRef.get(ref))
			.filter((element): element is VisualElement => Boolean(element))
			.map((element) => `${element.ref} ${element.role}${element.name ? ` "${element.name}"` : ""}`);
		return `${cluster.id} at (${cluster.at[0]},${cluster.at[1]}): ${members.join(" | ")}`;
	});
}
