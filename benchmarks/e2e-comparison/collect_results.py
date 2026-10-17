#!/usr/bin/env python3
"""Collect benchmark runs from /tmp/opencode/bench/results into a markdown table."""

from __future__ import annotations

import importlib.util
import json
import pathlib
import re

BENCH = pathlib.Path("/tmp/opencode/bench")
RESULTS = BENCH / "results"
USAGE_KEYS = ("input", "output", "cacheRead", "cacheWrite", "reasoning")
RUN_RE = re.compile(r"^\d{8}-\d{6}-(upstream|fork)-(calc|wikipedia|eclipse)$")

spec = importlib.util.spec_from_file_location("verify", pathlib.Path(__file__).with_name("verify.py"))
verify = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(verify)


def session_summary(session: pathlib.Path) -> tuple[int, int, dict]:
    totals = {key: 0 for key in USAGE_KEYS}
    turns = 0
    tools = 0
    for line in session.read_text(errors="replace").splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        stack = [entry]
        counted = False
        while stack and not counted:
            node = stack.pop()
            if isinstance(node, dict):
                usage = node.get("usage")
                if isinstance(usage, dict) and "input" in usage and "output" in usage:
                    for key in USAGE_KEYS:
                        value = usage.get(key)
                        if isinstance(value, (int, float)):
                            totals[key] += value
                    turns += 1
                    counted = True
                    break
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
        content = entry.get("message", entry).get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "toolCall":
                    tools += 1
    return turns, tools, totals


def wall(run_dir: pathlib.Path) -> float | None:
    def read(name: str) -> float | None:
        path = run_dir / "out" / name
        try:
            return float(path.read_text().strip())
        except (OSError, ValueError):
            return None

    start, end = read("start.epoch"), read("end.epoch")
    return (end - start) if start and end else None


def exit_code(run_dir: pathlib.Path) -> str:
    path = run_dir / "out" / "pi-stdout.log"
    if not path.is_file():
        return "?"
    for line in reversed(path.read_text(errors="replace").splitlines()):
        if line.startswith("PI_EXIT="):
            return line.split("=", 1)[1]
    return "?"


def main() -> int:
    rows = []
    for run in sorted(RESULTS.iterdir()):
        match = RUN_RE.match(run.name)
        if not run.is_dir() or not match:
            continue
        arm, task = match.groups()
        sessions = sorted((run / "sessions").rglob("*.jsonl"), key=lambda p: p.stat().st_mtime)
        turns = tools = 0
        totals = {key: 0 for key in USAGE_KEYS}
        if sessions:
            turns, tools, totals = session_summary(sessions[-1])
        seconds = wall(run)
        vfunc = {
            "calc": verify.verify_calc,
            "eclipse": verify.verify_eclipse,
            "wikipedia": verify.verify_wikipedia,
        }[task]
        ok, notes = vfunc(run)
        rows.append(
            {
                "run": run.name[16:],
                "arm": arm,
                "task": task,
                "wall": f"{seconds:.0f}s" if seconds is not None else "?",
                "turns": turns,
                "tools": tools,
                "tin": totals["input"] + totals["cacheRead"] + totals["cacheWrite"],
                "tout": totals["output"] + totals["reasoning"],
                "exit": exit_code(run),
                "ok": ok,
                "notes": "; ".join(notes)[:220],
            }
        )

    print("| run | arm | task | wall | turns | tool calls | tokens in | tokens out | exit | result |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for row in rows:
        print(
            f"| {row['run']} | {row['arm']} | {row['task']} | {row['wall']} | {row['turns']} | "
            f"{row['tools']} | {row['tin']:,} | {row['tout']:,} | {row['exit']} | "
            f"{'PASS' if row['ok'] else 'FAIL'} |"
        )
    print()
    for row in rows:
        print(f"- {row['run']}: {row['notes']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
