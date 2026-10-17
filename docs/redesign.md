# v2 redesign: the model-facing contract

Status: v2 tools wired (2026-10-17); live E2E in `scripts/check-visual-live.mjs`. Scope: Linux/X11. Baseline: upstream `main` at `67e9e2f` (post-#103).

## Goals

- A model-first contract: the agent receives a compact JSON snapshot and at most one image per observation.
- Semantic first, pixels last — but pixels are verifiable, never a blind guess.
- Every claim measured on the models we actually run, starting with DeepSeek V4.1 Flash (see [baseline](#baseline-deepseek-v41-flash)).

## Tool surface (draft)

| tool | purpose |
|------|---------|
| `observe` | current snapshot: window meta + elements + text; optional annotated screenshot |
| `act` | `steps[]` (`click` / `type` / `key` / `scroll` / `drag` / `wait` / `aim` / `commit`); pre-validated; returns the new snapshot plus a change report |
| `read` | full text of a truncated element or a text continuation |
| `zoom` | native-resolution crop of a region or element, with graticule |
| `wait` | condition on text / change / focus with timeout |
| `find` | element filter by role or text — keep only if a flat snapshot proves too large |

The browser tools (`launch_browser`, `navigate_browser`, `evaluate_browser`) stay as they are initially; their snapshots get converted to the same format in M2.

Rules:

- **No epochs.** `act` accepts only the latest state; a stale state returns the fresh snapshot instead of an error.
- **Validate before dispatch.** If any step in a batch is invalid, nothing is dispatched; the error names the step and the valid alternatives.
- **Always report outcomes.** Every act returns a compact change report (`changed`, `focused`, `appeared`, `removed`). `changed: false` is a signal, not a success.
- **Text-only models still work**, minus the visual modality. The extension reads the active model's input modalities (`ctx.model.input`, `"text" | "image"`), omits images, and adds a one-line advisory that a vision-capable model is strongly recommended for computer use, with the agent offering to switch.

**Wired now (2026-10-17):** observation JSON in `observe_ui` compact views (desktop and browser); per-cluster listing; annotated overviews wherever images are attached; `zoom_ui`; coordinate-click aim preview (`aim_preview`, default on) with `commit` and `confirm: true`; post-click hit reports; the modality advisory; browser pages via CDP: v2 observations, viewport screenshots, rects from `getBoundingClientRect`, zoom and aim previews in viewport pixels; helper-side geometry normalization (window-relative rects with screen/window coordinate calibration and a GTK `GetExtents` window-space fallback).

**Still upstream for now:** refs/state epochs (no auto-refresh on stale state) and outline-based `search_ui`/`expand_ui`/`inspect_ui`.

## Snapshot (JSON)

```json
{
  "state": "s7",
  "window": { "app": "Chromium", "title": "Example Domain", "screen": [10, 10], "size": [945, 1060] },
  "elements": [
    { "id": 8, "role": "button", "name": "Sign in to Chromium?", "rect": [687, 36, 199, 34], "actions": ["press"] },
    { "id": 12, "role": "entry", "name": "Address and search bar", "value": "example.com", "rect": [146, 53, 512, 28], "focused": true }
  ],
  "clusters": [
    { "id": "C1", "at": [820, 48], "elements": [3, 4, 5] }
  ],
  "text": [
    "This domain is for use in documentation examples without needing permission. ...",
    "هذا النطاق مُخصص للاستخدام في أمثلة التوثيق ..."
  ],
  "truncated": { "text": false }
}
```

Rules:

- **Flat list, no tree, no containers.** Roles normalized to a small vocabulary; `panel`, `frame`, `document`, `static` are structure, not elements. In the prototype, this cut 240 AT-SPI nodes to 25 elements.
- **Clusters stay clickable.** Elements whose badges would overlap are grouped; the image shows one marker per cluster (`C1`, `C2`, …) and the listing carries the member ids (decision 2026-10-16: per-cluster listing).
- **Capture-relative.** Only nodes that intersect the captured image are listed; AT-SPI rects can extend outside it (window decorations, `y = -10` controls). Rectangles stay in screen coordinates; the image is a scaled view with a known origin.
- **Sanitized values.** No U+FFFC, no D-Bus paths, no duplicated statics; window title does not leak into body text.
- **Text in one reading-order block**, capped (~2 KB) with continuation through `read`.
- **IDs are local to one state.** Cross-state stable IDs are an M1 research item; until then the model always acts on the newest snapshot.

## Visual contract

### Geometry normalization

- The helper emits **window-relative** rects (0, 0 = capture origin) so model geometry and the captured image share one space; the renderer never subtracts a window origin from node rects.
- AT-SPI coordinate spaces differ by toolkit: Chromium answers `GetExtents(0)` in screen coordinates, some GTK stacks answer in window coordinates (and report `0, 0` positions when the toplevel origin is unavailable). The helper calibrates on the root node's own extents and falls back to `GetExtents(1)` (window space) for nodes whose screen position looks unavailable.
- GTK dialogs that used to list no elements at all (zenity) now expose buttons and text fields with usable rects.

### Overview rendering

- The helper capture is already scaled (900 px in fused mode, 1600 px in visual mode); overlays are drawn at capture scale, after any scaling, so they stay crisp.
- Element outline: 4 px black under-stroke + 2 px orange. Badge: 18 px circle with a 14 px numeral, offset above-left of the target (inside the corner when there is no room). Clustered elements get one marker instead of colliding badges.
- Rulers: edge strips with **screen-coordinate** labels roughly every 10 % (minimum ~96 px at render scale), labels ≥ 10 px. **No fine grid on the overview** — after provider downscaling it aliases into mush; 10 px guides only belong in crops.

![annotated overview](images/visual-loop-overview.png)

### Zoom

- `zoom_ui {ref | x,y,w,h}` returns a native-resolution crop with a fine graticule: 10 px minor lines, 50 px major lines, labels every 50 px in screen coordinates. Element crops auto-fit (output capped near 1200 px, upscale ≤ 6×).
- Upscaling is the only way to move detail below the provider's encoder patch size; it is the magnifier the overview cannot be.

![aim crop with graticule](images/visual-loop-aim-crop.png)

### Browser pages (CDP)

- Browser observations use the **same pipeline**: `cdpSnapshotForContext` already normalizes the Chrome accessibility tree into the shared outline shape, and now also emits the v2 JSON (`buildBrowserSnapshot`): elements with `@e` refs, viewport rects, clusters, `url`, and paragraph blocks split from `innerText`.
- Geometry comes from one `getBoundingClientRect` call per actionable target (capped at 120). Viewport CSS pixels are the action space: coordinate actions dispatch in viewport pixels and screenshots are captured clipped at CSS scale, so screenshot pixels and action pixels are identical (no device-pixel-ratio math).
- Actionability follows the AX tree: Chrome camelCase roles (`textField`, `toggleButton`, …) are mapped, nodes reporting the AX `editable` property count as text inputs, and inputs without an accessible name are still targets when they carry a value — so the observation's elements and the refs that actions accept stay in sync.
- Screenshot policy follows `mode`: `visual` always captures, `semantic` never, `fused` attaches when the page exposes fewer than three named targets. `zoom_ui` and aim previews capture on demand when the snapshot has no screenshot.
- Ref clicks stay DOM-level (`resolveNode` + `this.click()` / value set) — they need no geometry at all; the visual layer is for verification and coordinate fallbacks.
- Armed aim points expire when the snapshot changes, the URL changes, or the page scrolls (`window.scrollX/scrollY` is re-checked at commit).

### Aim → verify → commit (pixel fallback)

- `act_ui {actions:[{aim:{x,y}}]}` renders a preview: overview with crosshair **plus** a native crop centered on the point, and reports the element under it. Nothing is dispatched; the result arms the point.
- `act_ui {actions:[{commit}]}` dispatches the armed click once; any new look (a new observation or a completed action) expires it.
- **Preview is on by default.** A lone coordinate click previews automatically; `confirm: true` on the click dispatches immediately. Disable entirely with `aim_preview: false`. Text-only models skip previews (they cannot see them) and dispatch directly.
- Every coordinate action now carries a **hit report** after dispatch: the element under the point *before → after*, for up to three clicks/moves/drags, on desktop windows and browser pages alike. Aim previews report the same "under the point" before anything is dispatched, so a failed click is never silent.
- Coordinate actions need XTEST: under `headless` the transaction batches with the `ax_only` policy, physical delivery is impossible, and the hit report says so instead of failing silently.
- Still pending: anchor clicks (`{click: {id, anchor: …}}`) for sliders and drag tracks.

## Baseline: DeepSeek V4.1 Flash

Method: 8 rendered cards (1536×864), one isolated blue target each (16–64 px), half with edge rulers; the model read each card once and reported the target center; truth was withheld until guesses were recorded. Scripts and the full table: [`benchmarks/visual-acuity`](../benchmarks/visual-acuity/README.md).

Result: **8/8 hits, mean error 3.5 px @1536 (≈4.4 px at 1920-wide), per-size means 2.1–5.5 px, rulers made no significant difference.**

Implications:

- Pointing precision is *not* the bottleneck. The pain in real sessions is target **identification** in dense or ambiguous UIs, and the absence of verification.
- The aim → verify loop is still worth having — it is cheap insurance against semantic mistakes — but its crop can be tight (~300×240) and its graticule is for disambiguation, not calibration.
- Label floor: 14–16 px UI text and badge numerals read comfortably; 8 px ruler labels were marginal.

Caveats: single 8-card run; isolated high-contrast targets; measured through this machine's opencode image pipeline (pi may deliver images differently); self-administered scoring (truth withheld until guesses existed).

## Implementation

`src/visual` (`snapshot*.ts` model with a `visual/browser.ts` adapter, `format.ts`, `overlays.ts`) holds the observation model; `jimp` is a runtime dependency (overlays stay in TypeScript). The Pi tools call it directly:

- `observe_ui` compact views return the JSON observation (`formatObservation`) for desktop looks and browser pages; the annotated overview is attached wherever the image policy attaches an image (`mode: "visual"` always, fused on fallback / sparse pages).
- `act_ui` gains `aim` / `commit`; lone coordinate clicks preview by default (`aim_preview`, default on; `confirm: true` bypasses). Previews work on both paths and skip text-only models.
- `zoom_ui` renders a native-resolution crop of a ref or region on both paths.
- The modality advisory appears when `ctx.model.input` lacks `"image"`.

Checks: `scripts/check-visual.mjs` (unit) and `scripts/check-visual-live.mjs` (`PI_CU_LIVE=1`; Xvfb + Chromium) drives observation → zoom → aim → commit → hit report → confirm bypass → text-only advisory on the desktop path and again over CDP for a browser page, with page-side echo/counter assertions proving where the pixels landed. `scripts/spike/visual-loop.ts` remains the standalone renderer demo. The Rust helper normalizes rects to window-relative space (unit-tested for screen-space, window-space, and per-node recovered coordinates).

Known gaps: anchor clicks for sliders and drag tracks; GTK window coordinates can start a few pixels off the client origin (zenity reports −5, −5), so GTK outlines can sit a few pixels off — visible in the crops and harmless for pointing; frame-less AT-SPI roots (no X11 window) still fall back to a 1×1 capture with no geometry.

## Decisions (2026-10-16)

1. Dense clusters use **per-cluster listing**: one marker on the image, member elements listed and clickable by id.
2. The aim preview is **on by default**; disable with `aim_preview: false`.
3. Overlays are computed in **TypeScript** (`src/visual`).
4. Text-only models keep the extension but lose images; observations advise that a vision-capable model is strongly recommended and suggest asking the user to switch. Detected automatically from `ctx.model.input`, so no config is needed.

## Open questions

1. Does `find`/`search` survive a flat snapshot, or does text search belong in the harness alone?
2. Cross-state stable element IDs — worth it, or always act on the newest snapshot?
