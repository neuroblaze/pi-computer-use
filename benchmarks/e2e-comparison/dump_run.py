#!/usr/bin/env python3
"""Compact transcript dump for a benchmark run directory.

Usage: dump_run.py <run-dir> [pattern]
Prints assistant turns as `[n] TEXT: ... | CALL tool {...}`; with a pattern,
only matching lines (and matching tool results) are printed.
"""

from __future__ import annotations

import json
import pathlib
import sys


def main() -> int:
    run = pathlib.Path(sys.argv[1])
    pattern = sys.argv[2].lower() if len(sys.argv) > 2 else None
    sessions = sorted((run / "sessions").rglob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    if not sessions:
        print("no sessions")
        return 1
    turn = 0
    for line in sessions[-1].read_text(errors="replace").splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = entry.get("message", {})
        role = message.get("role")
        if role == "assistant":
            turn += 1
            parts: list[str] = []
            for part in message.get("content", []):
                if part.get("type") == "text" and part.get("text"):
                    parts.append("TEXT: " + part["text"][:220].replace("\n", " "))
                elif part.get("type") == "toolCall":
                    args = json.dumps(part.get("arguments", {}))[:170]
                    parts.append(f"CALL {part.get('name')} {args}")
            rendered = f"[{turn}] " + " | ".join(parts)
            if not pattern or pattern in rendered.lower():
                print(rendered)
        elif role == "toolResult" and pattern:
            text = " ".join(c.get("text", "") for c in message.get("content", []) if c.get("type") == "text")
            if pattern in text.lower():
                print(f"    RESULT({message.get('toolName')}): " + text[:220].replace("\n", " "))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
