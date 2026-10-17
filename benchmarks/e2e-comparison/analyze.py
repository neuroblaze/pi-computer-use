#!/usr/bin/env python3
"""Sum tokens and turns for benchmark runs from pi session JSONL files."""

from __future__ import annotations

import json
import pathlib
import sys

BENCH = pathlib.Path("/tmp/opencode/bench")
USAGE_KEYS = ("input", "output", "cacheRead", "cacheWrite", "reasoning")


def iter_lines(path: pathlib.Path):
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def walk(value):
    """Yield every dict in a nested JSON value."""
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def summarize(arm: str) -> None:
    arm_dir = BENCH / arm
    session_dir = arm_dir / "sessions"
    sessions = sorted(session_dir.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    if not sessions:
        print(f"{arm}: no session files under {session_dir}")
        return
    session = sessions[-1]

    totals = {key: 0 for key in USAGE_KEYS}
    turns = 0
    tool_calls = 0
    for entry in iter_lines(session):
        message = entry.get("message", entry)
        for node in walk(entry):
            usage = node.get("usage")
            if isinstance(usage, dict) and "input" in usage and "output" in usage:
                for key in USAGE_KEYS:
                    value = usage.get(key)
                    if isinstance(value, (int, float)):
                        totals[key] += value
                turns += 1
                break
        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "toolCall":
                    tool_calls += 1

    def seconds(name: str) -> float | None:
        path = arm_dir / "out" / name
        if not path.is_file():
            return None
        try:
            return float(path.read_text().strip())
        except ValueError:
            return None

    start, end = seconds("start.epoch"), seconds("end.epoch")
    wall = f"{end - start:.0f}s" if start and end else "?"
    tokens_in = totals["input"] + totals["cacheRead"] + totals["cacheWrite"]
    tokens_out = totals["output"] + totals["reasoning"]
    exit_line = ""
    log = arm_dir / "out" / "pi-stdout.log"
    if log.is_file():
        for line in log.read_text(errors="replace").splitlines():
            if line.startswith("PI_EXIT="):
                exit_line = " " + line
    print(f"{arm}: wall={wall} turns={turns} tool_calls={tool_calls}{exit_line}")
    print(f"  tokens in={tokens_in} (input={totals['input']}, cacheRead={totals['cacheRead']}, cacheWrite={totals['cacheWrite']})")
    print(f"  tokens out={tokens_out} (output={totals['output']}, reasoning={totals['reasoning']})")
    print(f"  session={session}")


def main() -> int:
    arms = sys.argv[1:] or ["upstream", "fork"]
    for arm in arms:
        summarize(arm)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
