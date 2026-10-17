# Visual-acuity probe

Measures one model's ability to point at a target in a rendered screenshot, blindly.

## Method

1. `node generate.mjs --out <dir>` renders 8 cards (1536×864, UI-like clutter and gray-ring decoys), each with one blue target disc of 16/32/48/64 px at a random position. Sizes cycle; cards 5–8 add edge rulers labeled in card pixels. Truth is written to `truth.json`.
2. The model under test reads the cards one by one and records its estimate of the target center in `guesses.json`. `truth.json` must not be read until guesses are recorded.
3. `node reveal.mjs <dir>` scores the guesses: error in px, % of card width, hit = error ≤ target radius, plus per-size and ruler/no-ruler summaries.

## Result — DeepSeek V4.1 Flash (2026-10-16, this machine's opencode image pipeline)

| card | target d | rulers | error (px @1536) | hit |
|------|----------|--------|------------------|-----|
| 1 | 16 | no  | 1.4 | yes |
| 2 | 32 | no  | 2.2 | yes |
| 3 | 48 | no  | 2.0 | yes |
| 4 | 64 | no  | 9.5 | yes |
| 5 | 16 | yes | 2.8 | yes |
| 6 | 32 | yes | 3.2 | yes |
| 7 | 48 | yes | 5.4 | yes |
| 8 | 64 | yes | 1.4 | yes |

Overall: mean 3.5 px, median 2.8 px, 8/8 hits; ≈4.4 px mean on a 1920-wide screen. Rulers made no significant difference (mean 3.2 px with vs 3.8 px without, n=4 each).

Observations:

- Pointing accuracy for isolated, high-contrast targets is a few pixels — much better than assumed. The failure mode to design around is target *identification* in dense or ambiguous UIs, not raw localization.
- 14–16 px UI text and badge numerals read comfortably; the 8 px ruler labels were marginal (readable on the overview render, easy to skip on the test cards).

## Caveats

- Single 8-card run (n=2 per size). Rerun with several seeds before trusting tight thresholds.
- Targets were isolated and high-contrast; real toolbars are denser and full of lookalikes.
- Measured through this machine's opencode image pipeline; pi may deliver images differently (resize/encoder path). Treat absolute numbers as an order of magnitude and the method as the reusable part.
- Self-administered scoring: the same model wrote the guesses and later read the truth, with truth withheld until `guesses.json` existed.

## Rerunning

```sh
node benchmarks/visual-acuity/generate.mjs --out spike-out/acuity [--seed N]
# have the model read spike-out/acuity/card-*.png, then write guesses.json:
# {"1": {"x": 378, "y": 372}, ...}
node benchmarks/visual-acuity/reveal.mjs spike-out/acuity
```
