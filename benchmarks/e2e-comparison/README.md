# e2e-comparison — upstream vs this fork

Before/after comparison run before the v0.6.0 release candidate. Two tasks,
both arms, DeepSeek v4.1 Flash on Ollama Cloud, thinking `high`, 45-minute cap,
fresh VM per run, `--no-builtin-tools` so the agent only has computer-use tools.

- **upstream** — `injaneity/pi-computer-use` @ `67e9e2f` (the fork point), with
  its own helper built from source.
- **fork** — this repository at the `next` tip being benchmarked.

## Tasks

| Task | App | Success check |
|---|---|---|
| `calc` | LibreOffice Calc (bench2 image) | `calc-report.csv` matches Region/Revenue, North 1200, South 800, Total 2000 |
| `wikipedia` | Chromium via the extension's browser tools | `FINAL:` line with London / Ada / Jean Ichbiah (after the Deutsch language switch) |

The `eclipse` task prompt and verifier are kept for reference but are **not
used**: Eclipse's SWT/GTK stack crashed with SIGSEGV inside GTK's accessibility
code (`gtk_widget_get_parent` from `gtk_main_iteration_do`) after ~8 minutes of
interaction in this environment, while surviving idle. A 45-minute interactive
run would be decided by that crash instead of the extension, so the
pre-agreed LibreOffice fallback replaced it.

## Results (two runs per cell, sequential, same day)

| run | arm | task | wall | turns | tool calls | tokens in | tokens out | result |
|---|---|---|---|---|---|---|---|---|
| 1 | upstream | calc | 261s | 86 | 100 | 4,748,195 | 58,247 | **FAIL** (`Err:522` circular ref in B2, Total empty) |
| 2 | upstream | calc | 217s | 119 | 141 | 8,185,285 | 44,837 | PASS |
| 3 | fork | calc | 274s | 97 | 106 | 5,196,717 | 42,259 | PASS |
| 4 | fork | calc | 252s | 64 | 83 | 3,825,645 | 53,078 | PASS |
| 5 | upstream | wikipedia | 272s | 80 | 99 | 5,046,183 | 39,421 | PASS |
| 6 | upstream | wikipedia | 83s | 39 | 47 | 994,024 | 13,526 | PASS |
| 7 | fork | wikipedia | 114s | 44 | 49 | 1,711,044 | 16,659 | PASS |
| 8 | fork | wikipedia | 261s | 82 | 91 | 5,456,883 | 30,726 | PASS |

Means:

| task | arm | success | wall | turns | tool calls | tokens in | tokens out |
|---|---|---|---|---|---|---|---|
| calc | upstream | 1/2 | 239s | 102.5 | 120.5 | 6.47M | 51.5k |
| calc | fork | **2/2** | 263s | 80.5 | 94.5 | 4.51M | 47.7k |
| wikipedia | upstream | 2/2 | 178s | 59.5 | 73 | 3.02M | 26.5k |
| wikipedia | fork | 2/2 | 188s | 63.0 | 70 | 3.58M | 23.7k |

### What the numbers say

- **Non-browser task (LibreOffice Calc, the improved path):** the fork passed
  both runs; upstream failed one of two with a circular-reference formula typed
  into the wrong cell and never recovered. Across runs the fork needed ~21%
  fewer turns, ~22% fewer tool calls and ~30% fewer input tokens (output tokens
  ~7% lower). Wall clock is similar.
- **Browser task (Wikipedia + language switch, the no-regression path):** both
  arms passed all runs; efficiency is at parity (differences between runs of the
  same arm are larger than between arms on this sample). No regression.
- Neither arm hit the 45-minute cap; every run ended with exit 0.

### Qualitative notes

- The fork leans on `zoom_ui` (20–22 calls in calc, 6–19 in wikipedia) to read
  the grid/browser regions before acting; upstream has no equivalent and fell
  back to blind clicks, `search_ui`/`inspect_ui` walks and, in its passing calc
  run, writing a LibreOffice Basic macro (`Sub FillReport`) in the Basic IDE to
  fill the sheet — effective, but 119 turns and the most expensive run of all
  (8.19M input tokens).
- In calc, the fork's first pass used a blind grid click too, but it noticed
  "zoom labels are ambiguous", switched to `search_ui` for the Name Box and
  keyboard navigation, and verified the saved CSV afterwards by opening
  `file:///root/calc-report.csv` in the browser.
- Both arms completed the Wikipedia language switch (upstream via the language
  menu + a DOM click on the Deutsch link, fork via the language button and a ULS
  panel click); both ended on `de.wikipedia.org/wiki/Ada_(Programmiersprache)`.

Raw logs and sessions: `/tmp/opencode/bench/results/<timestamp>-<arm>-<task>/`
(also one fork pilot per task, plus the Eclipse attempt).

## Harness

- `run-one.sh <arm> <task> [timeout]` — host orchestrator; boots the bench
  image with VNC (`IMAGE=bench2` for the calc task), runs `common/run.sh`
  inside, stops the VM when done, archives artifacts under
  `/tmp/opencode/bench/results/`.
- `common/run.sh` — in-VM driver: app setup, then `pi -p` with the task prompt,
  session JSONL to `/workspace/sessions`, output to `/workspace/out`.
- `verify.py <arm> <task>` — independent host-side pass/fail.
- `analyze.py <arm>` / `collect_results.py` — tokens/turns/wall and the table.
- `dump_run.py <run-dir> [pattern]` — compact transcript dump.
- `common/settings.json` — pristine pi profile (ollama-cloud provider only) so
  the arms cannot clash with the installed upstream npm extension.
- Both arms run with the identical flag set: `--no-builtin-tools -na -nc -ns
  -np --exclude-tools ollama_web_search,ollama_web_fetch --no-extensions -e
  /workspace/repo -e <provider>/index.ts` — extension-only tool surface, no
  textual web-shortcut for the browser task.

## Environment

- Host: 8 GB RAM, sequential runs, one VM at a time.
- VM: smol-pi `bench2` image (stock computer-use desktop + Eclipse + LibreOffice
  Calc), 3072 MiB, 1920x1080 Xvfb, openbox, AT-SPI2, VNC.
- Model: `ollama-cloud/deepseek-v4.1-flash`, thinking `high`.
- Note: smolvm accumulates `~/.cache/smolvm/image-seeds/*` (one multi-GB
  qcow2 per image build) and `smol-pi clean` does not remove them; prune them
  if disk runs low.
