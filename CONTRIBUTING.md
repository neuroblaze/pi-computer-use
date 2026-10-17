# Contributing

This is a hard fork of [pi-computer-use](https://github.com/injaneity/pi-computer-use) with a Linux-only scope, so upstream contribution conventions don't apply here. Open an issue or a PR in this repository for changes.

## Setup

```bash
npm install
npm test
```

Use Node 22+. Run the checkout in Pi:

```bash
pi --no-extensions -e .
```

## Validation

- TypeScript or contract changes: `npm test`.
- Native helper changes: `cd native/linux/bridge-rs && cargo test --locked -j1 && cargo clippy --locked --all-targets -- -D warnings && cargo fmt --all -- --check`, then `npm run build:linux`.
- Live helper checks (inside a graphical session): `PI_CU_LIVE=1 npm run test:linux-live`.

Keep the public tool surface small and the protocol changes deliberate; the model-facing contract lives in `extensions/computer-use.ts` and `src/`.
