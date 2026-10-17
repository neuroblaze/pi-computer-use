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
	ref: string;
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
	refs: string[];
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
	const raw = [node.title, node.description].map((value) => value.trim()).find(Boolean) ?? "";
	if (!raw) return "";
	if (/^[\uFFFC\s]+$/.test(raw)) return "";
	if (raw.startsWith("/org/") || raw.includes("/org/a11y/")) return "";
	return raw;
}

function cleanValue(value: string): string {
	return value.replace(/\uFFFC/g, "").trim();
}

function normalizeRole(role: string): string {
	return role.replace(/^AX/, "").toLowerCase();
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
		if (!node.ref || !node.rect || node.offscreen || !visibleRect(node)) return false;
		const role = normalizeRole(node.role);
		if (!(INTERACTIVE_ROLES.has(role) || node.isTextInput || node.canSetValue)) return false;
		if (node.rect.w * node.rect.h > 0.6 * frameArea) return false;
		return Boolean(sanitizeName(node) || cleanValue(node.value) || node.isTextInput);
	});

	const seen = new Set<string>();
	const elements: VisualElement[] = [];
	for (const node of interactive) {
		const rect = visibleRect(node)!;
		const duplicateKey = `${node.role}|${sanitizeName(node)}|${rect.join(",")}`;
		if (seen.has(duplicateKey)) continue;
		seen.add(duplicateKey);
		elements.push({
			ref: node.ref,
			role: normalizeRole(node.role),
			name: sanitizeName(node),
			value: cleanValue(node.value) || undefined,
			rect,
			actions: node.actions,
			focused: node.focused || undefined,
		});
	}

	const badgeAnchor = (element: VisualElement): [number, number] => {
		const x = element.rect[0] * renderScale + BADGE_OFFSET_X;
		const y = element.rect[1] * renderScale - BADGE_OFFSET_Y > 16
			? element.rect[1] * renderScale - BADGE_OFFSET_Y
			: element.rect[1] * renderScale + BADGE_OFFSET_Y;
		return [x, y];
	};
	const anchors = new Map<string, [number, number]>(elements.map((element) => [element.ref, badgeAnchor(element)]));
	const distance = options.clusterDistance ?? DEFAULT_CLUSTER_DISTANCE;
	const parent = new Map<string, string>(elements.map((element) => [element.ref, element.ref]));
	const find = (ref: string): string => {
		let root = ref;
		while (parent.get(root)! !== root) root = parent.get(root)!;
		return root;
	};
	for (let i = 0; i < elements.length; i += 1) {
		for (let j = i + 1; j < elements.length; j += 1) {
			const [ax, ay] = anchors.get(elements[i].ref)!;
			const [bx, by] = anchors.get(elements[j].ref)!;
			if ((ax - bx) ** 2 + (ay - by) ** 2 <= distance * distance) {
				const ra = find(elements[i].ref);
				const rb = find(elements[j].ref);
				if (ra !== rb) parent.set(rb, ra);
			}
		}
	}
	const groups = new Map<string, string[]>();
	for (const element of elements) {
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

	const title = look.outline.title.trim();
	const text: string[] = [];
	let chars = 0;
	let truncated = false;
	const maxBlocks = options.maxTextBlocks ?? DEFAULT_MAX_TEXT_BLOCKS;
	const maxChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
	for (const node of nodes) {
		if (!TEXT_ROLES.has(normalizeRole(node.role)) || !visibleRect(node)) continue;
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
