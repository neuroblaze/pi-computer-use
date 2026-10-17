import type { VisualSnapshot } from "./snapshot.ts";

export interface ObservationOptions {
	stateId?: string;
	/** Maximum elements listed before the rest are counted as omitted. */
	maxElements?: number;
	maxValueChars?: number;
}

function compactValue(value: string, maxChars: number): string {
	return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

/**
 * Model-facing observation. One JSON object: state, window, elements (refs),
 * clusters, text. Elements and text are capped so the observation stays bounded.
 */
export function formatObservation(snapshot: VisualSnapshot, options: ObservationOptions = {}): string {
	const maxElements = options.maxElements ?? 80;
	const maxValueChars = options.maxValueChars ?? 80;
	const visible = snapshot.elements.slice(0, maxElements);
	const omitted = snapshot.elements.length - visible.length;

	const lines: string[] = ["{"];
	lines.push(` "state": ${JSON.stringify(options.stateId ?? "")},`);
	lines.push(` "window": { "app": ${JSON.stringify(snapshot.window.app)}, "title": ${JSON.stringify(snapshot.window.title)}, "screen": [${snapshot.window.screen.join(",")}], "size": [${snapshot.window.size.join(",")}] },`);
	lines.push(" \"elements\": [");
	visible.forEach((element, index) => {
		const parts = [`"ref": ${JSON.stringify(element.ref)}`, `"role": ${JSON.stringify(element.role)}`];
		if (element.name) parts.push(`"name": ${JSON.stringify(compactValue(element.name, maxValueChars))}`);
		if (element.value) parts.push(`"value": ${JSON.stringify(compactValue(element.value, maxValueChars))}`);
		parts.push(`"rect": [${element.rect.join(",")}]`);
		if (element.focused) parts.push("\"focused\": true");
		lines.push(`  { ${parts.join(", ")} }${index === visible.length - 1 ? "" : ","}`);
	});
	lines.push(" ],");
	if (omitted > 0) lines.push(` "elementsOmitted": ${omitted},`);
	if (snapshot.clusters.length > 0) {
		lines.push(" \"clusters\": [");
		snapshot.clusters.forEach((cluster, index) => {
			const refs = cluster.refs.map((ref) => JSON.stringify(ref)).join(", ");
			lines.push(`  { "id": ${JSON.stringify(cluster.id)}, "at": [${cluster.at.join(",")}], "refs": [${refs}] }${index === snapshot.clusters.length - 1 ? "" : ","}`);
		});
		lines.push(" ],");
	}
	lines.push(" \"text\": [");
	snapshot.text.forEach((block, index) => {
		lines.push(`  ${JSON.stringify(block)}${index === snapshot.text.length - 1 ? "" : ","}`);
	});
	lines.push(" ]");
	if (snapshot.truncated.text) {
		lines[lines.length - 1] = " ],";
		lines.push(" \"textTruncated\": true");
	}
	lines.push("}");
	return lines.join("\n");
}
