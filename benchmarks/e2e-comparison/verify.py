#!/usr/bin/env python3
"""Independent host-side verification for the benchmark runs."""

from __future__ import annotations

import csv
import io
import pathlib
import re
import sys

BENCH = pathlib.Path("/tmp/opencode/bench")


def verify_eclipse(arm_dir: pathlib.Path) -> tuple[bool, list[str]]:
    out = arm_dir / "out"
    notes: list[str] = []
    ok = True

    project = out / "workspace" / "bench-app" / ".project"
    if project.is_file() and "bench-app" in project.read_text(errors="replace"):
        notes.append(".project exists and names bench-app")
    else:
        ok = False
        notes.append("FAIL: bench-app/.project missing or does not name bench-app")

    java = None
    bench_app = out / "workspace" / "bench-app"
    if bench_app.is_dir():
        for candidate in sorted(bench_app.rglob("Main.java")):
            java = candidate
            break
    if java is None:
        ok = False
        notes.append("FAIL: Main.java not found under bench-app")
    else:
        source = java.read_text(errors="replace")
        if re.search(r'System\.out\.println\(\s*"hello from bench"\s*\)', source):
            notes.append(f"{java.relative_to(out)} prints 'hello from bench'")
        else:
            ok = False
            notes.append(f"FAIL: {java.relative_to(out)} lacks the exact println")
    return ok, notes


def verify_wikipedia(arm_dir: pathlib.Path) -> tuple[bool, list[str]]:
    log = arm_dir / "out" / "pi-stdout.log"
    if not log.is_file():
        return False, ["FAIL: pi-stdout.log missing"]
    lines = [
        line.strip()
        for line in log.read_text(errors="replace").splitlines()
        if re.match(r"\s*FINAL\s*:", line, re.IGNORECASE)
    ]
    if not lines:
        return False, ["FAIL: no FINAL: line in the reply"]
    final = lines[-1]
    lowered = final.lower()
    expected = {"london": "birth city", "ada": "language", "ichbiah": "designer"}
    missing = [label for token, label in expected.items() if token not in lowered]
    notes = [f"FINAL line: {final}"]
    notes += [f"FAIL: missing {label}" for label in missing]
    return not missing, notes


def verify_calc(arm_dir: pathlib.Path) -> tuple[bool, list[str]]:
    path = arm_dir / "out" / "calc-report.csv"
    if not path.is_file():
        return False, [f"FAIL: {path} missing"]
    text = path.read_text(errors="replace")
    rows = [row for row in csv.reader(io.StringIO(text)) if any(cell.strip() for cell in row)]
    normalized = [[cell.strip() for cell in row] for row in rows]
    expected = [
        ["Region", "Revenue"],
        ["North", "1200"],
        ["South", "800"],
        ["Total", "2000"],
    ]
    if len(normalized) != len(expected):
        return False, [f"FAIL: expected {len(expected)} rows, got {len(normalized)}: {normalized}"]
    notes: list[str] = []
    for got, want in zip(normalized, expected):
        if len(got) != len(want) or any(g.lower() != w.lower() for g, w in zip(got, want)):
            notes.append(f"FAIL: row {got} != {want}")
    if notes:
        return False, notes + [f"full CSV: {normalized}"]
    return True, ["CSV matches Region/Revenue, North 1200, South 800, Total 2000"]


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: verify.py <upstream|fork> <eclipse|wikipedia>")
        return 2
    arm, task = sys.argv[1], sys.argv[2]
    arm_dir = BENCH / arm
    verify = {"eclipse": verify_eclipse, "wikipedia": verify_wikipedia, "calc": verify_calc}[task]
    ok, notes = verify(arm_dir)
    for note in notes:
        print(f"  {note}")
    print(f"{arm}/{task}: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
