# AGENTS.md

Notes for agents working in this repository.

## What this is

- The `neuroblaze` hard fork of [`injaneity/pi-computer-use`](https://github.com/injaneity/pi-computer-use): a Pi extension for observing and controlling Linux/X11 desktop apps.
- **Linux-only by policy.** Do not reintroduce macOS/Windows code paths, helpers, or release plumbing.
- The `upstream` git remote points at the original repository. Do not merge it; cherry-pick Linux helper fixes when needed.

## Layout

- `extensions/computer-use.ts` — public Pi tool registration; keep it small.
- `src/bridge.ts`, `src/outline.ts`, `src/state.ts`, `src/runtime.ts` — tool runtime, outline rendering, state ownership, scheduling.
- `native/linux/bridge-rs` — Rust AT-SPI2/X11 helper (JSON-lines protocol).
- `scripts/setup-helper.mjs` — installs the helper to `~/.pi/agent/helpers/pi-computer-use/linux-bridge` (env override `PI_COMPUTER_USE_LINUX_HELPER_PATH`).
- `scripts/build-native.mjs` — builds `prebuilt/linux/<arch>/linux-bridge`.

## Checks

- TypeScript: `npm test` (requires Node 22+).
- Rust: `cargo test --locked -j1`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo fmt --all -- --check` in `native/linux/bridge-rs`.
- Helper build: `npm run build:linux`.

## Conventions

- Match the surrounding style (tabs, comments only where they explain non-obvious contracts).
- Keep the model-facing contract stable unless the change is intentional; update `scripts/check-tool-schemas.mjs` expectations and docs when tools change.
- Test end-to-end inside an X11 session (an Xvfb desktop works, e.g. smol-pi's computer-use image) before claiming behavior changes.
