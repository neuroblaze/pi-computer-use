# @neuroblaze/pi-computer-use

A Linux/X11 fork of [pi-computer-use](https://github.com/injaneity/pi-computer-use) — a [Pi](https://pi.dev) extension that lets AI agents observe and control desktop apps.

This fork is in active redesign. The goal is a smaller, model-first interface for Linux desktops and headless X11 sessions (such as [smol-pi](https://github.com/neuroblaze/smol-pi)'s computer-use image): simplified observations, a single action surface, fewer protocol round-trips, and first-class visual grounding. The v2 layer is already live for `observe_ui` / `act_ui` / `zoom_ui` on both desktop windows and browser pages; the remaining upstream-era tools are being folded in.

## Design

The v2 model-facing contract — compact JSON snapshot, annotated screenshots, and an aim → verify → commit loop for pixel clicks — lives in [`docs/redesign.md`](./docs/redesign.md), together with the DeepSeek V4.1 Flash vision baseline. The snapshot builder and overlays are in [`src/visual`](./src/visual) (desktop looks and CDP browser pages share the pipeline); [`scripts/spike/visual-loop.ts`](./scripts/spike/visual-loop.ts) runs them against a live window.

## Differences from upstream

- **Linux only.** macOS and Windows code, helpers, and release plumbing are removed.
- **GitHub release (no npm yet).** Install from a tag: `pi install git:github.com/neuroblaze/pi-computer-use@v0.6.0`. The Linux x64 helper ships prebuilt; ARM builds it on demand.
- **Same helper path** as upstream (`~/.pi/agent/helpers/pi-computer-use/linux-bridge`). Don't install both extensions in the same Pi profile at once.

## Install

```bash
# The upstream npm package registers the same tool names; remove it first.
pi remove npm:@injaneity/pi-computer-use
pi install git:github.com/neuroblaze/pi-computer-use@v0.6.0
```

The Linux x64 helper is shipped prebuilt inside the package and installed to
`~/.pi/agent/helpers/pi-computer-use/linux-bridge` — no Rust toolchain needed.
ARM64 builds the helper on demand (`PI_COMPUTER_USE_ALLOW_BUILD=1`, requires
Rust).

Inside smol-pi, Pi runs as root against a host-owned `~/.pi`, so git refuses the
checkout; run `git config --global --add safe.directory '*'` in the VM first.

## Development

```bash
npm install
npm test

# Build the Linux helper from source into prebuilt/linux/<arch>/linux-bridge
npm run build:linux

# Build and install the helper to ~/.pi/agent/helpers/pi-computer-use/linux-bridge
PI_COMPUTER_USE_ALLOW_BUILD=1 npm run postinstall

# Load this checkout in Pi
pi --no-extensions -e .
```

`npm test` includes the TypeScript checks and, on Linux, the platform and helper-script checks. Use Node 22+ (the repo's CI uses Node 22; Node 18 cannot load some dev dependencies). Native checks:

```bash
cd native/linux/bridge-rs
cargo test --locked -j1
cargo clippy --locked --all-targets -- -D warnings
cargo fmt --all -- --check
```

Inside a Pi session, `/computer-use` shows the active configuration and where it came from.

## Requirements

- Linux with an X11 session and a working AT-SPI2 accessibility bus (Xvfb is fine).
- Node.js 20.6+ to run Pi.
- A Rust toolchain only when building the helper from source.

## Upstream relationship

Forked from `injaneity/pi-computer-use` at upstream `main` (`67e9e2f`, 2026-10-16), MIT licensed. The Linux helper (`native/linux/bridge-rs`) and the TypeScript core are derived from that work; see [LICENSE](./LICENSE). The `upstream` git remote points at the original repository for reference and cherry-picks.

## License

MIT. Original work © 2026 Zane Chee and contributors; fork modifications © 2026 neuroblaze and contributors.
