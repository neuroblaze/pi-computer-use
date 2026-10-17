import type { LookResponse, OutlineNode } from "../outline.ts";

const INTERACTIVE_ROLES = new Set([
	"push button", "button", "toggle button", "link", "entry", "textbox",
	"checkbox", "check box", "radio button", "combo box", "menu item",
	"check menu item", "radio menu item", "tab", "slider", "spin button",
]);
const TEXT_ROLES = new Set(["static", "paragraph", "heading", "label", "caption", "text"]);

export const DEFAULT_MAX_EDGE = 1536;
export const DEFAULT_CLUSTER_DISTANCE = 22;
const DEFAULT_MAX_TEXT_BLOCKS = 40;
const DEFAULT_MAX_TEXT_CHARS = 2000;
const BADGE_OFFSET_X = 11;
const BADGE_OFFSET_Y = 13;

export interface VisualElement {
	id: number;
	role: string;
	name: string;
	value?: string;
	rect: [number, number, number, number];
	actions: string[];
	focused?: boolean;
}

export interface VisualCluster {
	id: string;
	at: [number, number];
	elements: number[];
}

export interface VisualSnapshot {
	window: {
		app: string;
		title: string;
		screen: [number, number];
		size: [number, number];
		capture: [number, number];
	};
	elements: VisualElement[];
	clusters: VisualCluster[];
	text: string[];
	truncated: { text: boolean };
}

export interface SnapshotOptions {
	app?: string;
	/** Render edge used for cluster distances; must match the renderer. */
	maxEdge?: number;
	/** Distance between badge anchors, at render scale, below which elements cluster. */
	clusterDistance?: number;
	maxTextBlocks?: number;
	maxTextChars?: number;
}

function sanitizeName(node: OutlineNode): string {
	const raw = [node.title, node.description].map((value) => value.trim()).find(Boolean) ?? "";
	if (!raw) return "";
	if (/^[\uFFFC\s]+$/.test(raw)) return "";
	if (raw.startsWith("/org/") || raw.includes("/org/a11y/")) return "";
	return raw;
}

function cleanValue(value: string): string {
	return value.replace(/\uFFFC/g, "").trim();
}

export function buildVisualSnapshot(look: LookResponse, options: SnapshotOptions = {}): VisualSnapshot {
	const frame = look.window.framePoints;
	const captureW = Math.max(1, look.image?.width ?? Math.round(frame.w));
	const captureH = Math.max(1, look.image?.height ?? Math.round(frame.h));
	const scaleX = captureW / Math.max(1, frame.w);
	const scaleY = captureH / Math.max(1, frame.h);
	const renderScale = Math.min(1, (options.maxEdge ?? DEFAULT_MAX_EDGE) / Math.max(captureW, captureH));
	const frameArea = Math.max(1, frame.w * frame.h);

	const visibleRect = (node: OutlineNode): [number, number, number, number] | undefined => {
		if (!node.rect) return undefined;
		const x = (node.rect.x - frame.x) * scaleX;
		const y = (node.rect.y - frame.y) * scaleY;
		const w = node.rect.w * scaleX;
		const h = node.rect.h * scaleY;
		if (x + w <= 0 || y + h <= 0 || x >= captureW || y >= captureH) return undefined;
		return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
	};

	const nodes = look.parsedOutline?.nodes ?? [];
	const interactive = nodes.filter((node) => {
		if (!node.rect || node.offscreen || !visibleRect(node)) return false;
		const role = node.role.toLowerCase();
		if (!(INTERACTIVE_ROLES.has(role) || node.isTextInput || node.canSetValue)) return false;
		if (node.rect.w * node.rect.h > 0.6 * frameArea) return false;
		return Boolean(sanitizeName(node) || cleanValue(node.value) || node.isTextInput);
	});

	const elements: VisualElement[] = interactive.map((node, index) => ({
		id: index + 1,
		role: node.role.toLowerCase(),
		name: sanitizeName(node),
		value: cleanValue(node.value) || undefined,
		rect: visibleRect(node)!,
		actions: node.actions,
		focused: node.focused || undefined,
	}));

	const badgeAnchor = (element: VisualElement): [number, number] => {
		const x = element.rect[0] * renderScale + BADGE_OFFSET_X;
		const y = element.rect[1] * renderScale - BADGE_OFFSET_Y > 16
			? element.rect[1] * renderScale - BADGE_OFFSET_Y
			: element.rect[1] * renderScale + BADGE_OFFSET_Y;
		return [x, y];
	};
	const anchors = new Map<number, [number, number]>(elements.map((element) => [element.id, badgeAnchor(element)]));
	const distance = options.clusterDistance ?? DEFAULT_CLUSTER_DISTANCE;
	const parent = new Map<number, number>(elements.map((element) => [element.id, element.id]));
	const find = (id: number): number => {
		let root = id;
		while (parent.get(root)! !== root) root = parent.get(root)!;
		return root;
	};
	for (let i = 0; i < elements.length; i += 1) {
		for (let j = i + 1; j < elements.length; j += 1) {
			const [ax, ay] = anchors.get(elements[i].id)!;
			const [bx, by] = anchors.get(elements[j].id)!;
			if ((ax - bx) ** 2 + (ay - by) ** 2 <= distance * distance) {
				const ra = find(elements[i].id);
				const rb = find(elements[j].id);
				if (ra !== rb) parent.set(rb, ra);
			}
		}
	}
	const groups = new Map<number, number[]>();
	for (const element of elements) {
		const root = find(element.id);
		const group = groups.get(root);
		if (group) group.push(element.id);
		else groups.set(root, [element.id]);
	}
	const clusters: VisualCluster[] = [];
	for (const ids of groups.values()) {
		if (ids.length < 2) continue;
		const xs = ids.map((id) => anchors.get(id)![0]);
		const ys = ids.map((id) => anchors.get(id)![1]);
		const at: [number, number] = [
			Math.round(xs.reduce((a, b) => a + b, 0) / ids.length / renderScale),
			Math.round(ys.reduce((a, b) => a + b, 0) / ids.length / renderScale),
		];
		clusters.push({ id: `C${clusters.length + 1}`, at, elements: ids });
	}

	const title = look.outline.title.trim();
	const text: string[] = [];
	let chars = 0;
	let truncated = false;
	const maxBlocks = options.maxTextBlocks ?? DEFAULT_MAX_TEXT_BLOCKS;
	const maxChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
	for (const node of nodes) {
		if (!TEXT_ROLES.has(node.role.toLowerCase()) || !visibleRect(node)) continue;
		const block = cleanValue(node.value) || sanitizeName(node);
		if (!block || block === title) continue;
		if (text[text.length - 1] === block) continue;
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

	return {
		window: {
			app: options.app ?? "",
			title,
			screen: [Math.round(frame.x), Math.round(frame.y)],
			size: [Math.round(frame.w), Math.round(frame.h)],
			capture: [captureW, captureH],
		},
		elements,
		clusters,
		text,
		truncated: { text: truncated },
	};
}

/** Elements containing a point in capture-relative native pixels. */
export function elementAt(snapshot: VisualSnapshot, x: number, y: number): VisualElement[] {
	return snapshot.elements.filter((element) =>
		x >= element.rect[0] && x < element.rect[0] + element.rect[2] &&
		y >= element.rect[1] && y < element.rect[1] + element.rect[3]);
}

/** One line per cluster, listing the member elements by id so they stay clickable. */
export function describeClusters(snapshot: VisualSnapshot): string[] {
	const byId = new Map(snapshot.elements.map((element) => [element.id, element]));
	return snapshot.clusters.map((cluster) => {
		const members = cluster.elements
			.map((id) => byId.get(id))
			.filter((element): element is VisualElement => Boolean(element))
			.map((element) => `${element.id} ${element.role}${element.name ? ` "${element.name}"` : ""}`);
		return `${cluster.id} at (${cluster.at[0]},${cluster.at[1]}): ${members.join(" | ")}`;
	});
}
