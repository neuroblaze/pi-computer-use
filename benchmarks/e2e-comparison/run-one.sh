#!/bin/sh
# Host-side orchestrator: run one benchmark arm x task in a fresh VM.
# Usage: run-one.sh <upstream|fork> <eclipse|wikipedia> [timeout_seconds]
#
# Expects the arm directory at /tmp/opencode/bench/<arm> with:
#   repo/    extension checkout (worktree)
#   helper/  linux-bridge built from that checkout
# and the shared pi profile at /tmp/opencode/bench/pi-home.
set -u

ARM="${1:?usage: run-one.sh <upstream|fork> <eclipse|wikipedia> [timeout]}"
TASK="${2:?task}"
TMO="${3:-2700}"
ARM_DIR="/tmp/opencode/bench/$ARM"
PI_HOME=/tmp/opencode/bench/pi-home
SRC="$(cd "$(dirname "$0")" && pwd)"
SMOL_PI=/home/peter/projects/smol-pi/smol-pi
IMAGE="${IMAGE:-bench2}"

# Fresh harness copy and pristine pi settings for every run.
rm -rf "$ARM_DIR/common" "$ARM_DIR/tasks" "$ARM_DIR/out" "$ARM_DIR/sessions" "$ARM_DIR/done" "$ARM_DIR/out-console.log"
cp -a "$SRC/common" "$ARM_DIR/common"
cp -a "$SRC/tasks" "$ARM_DIR/tasks"
cp "$SRC/common/settings.json" "$PI_HOME/agent/settings.json"

cd "$ARM_DIR" || exit 1
timeout $((TMO + 900)) "$SMOL_PI" --image "$IMAGE" --mem 3072 --vnc --pi-dir "$PI_HOME" \
	--shell -c "PI_BENCH_TIMEOUT=$TMO sh /workspace/common/run.sh $TASK" >"$ARM_DIR/out-console.log" 2>&1 &
SMOLPID=$!

# The smol-pi wrapper lingers after the guest command finishes; stop it once
# the run's done-marker (written last by run.sh) appears.
while kill -0 "$SMOLPID" 2>/dev/null; do
	if [ -f "$ARM_DIR/done" ]; then
		sleep 10
		kill -TERM "$SMOLPID" 2>/dev/null
		break
	fi
	sleep 5
done
wait "$SMOLPID" 2>/dev/null

# Archive this run's artifacts (the next run cleans the arm dir).
RESULT_DIR="/tmp/opencode/bench/results/$(date +%Y%m%d-%H%M%S)-$ARM-$TASK"
mkdir -p "$RESULT_DIR"
cp -a "$ARM_DIR/out" "$RESULT_DIR/out" 2>/dev/null
cp -a "$ARM_DIR/sessions" "$RESULT_DIR/sessions" 2>/dev/null
cp -a "$ARM_DIR/out-console.log" "$RESULT_DIR/" 2>/dev/null

echo "run-one: arm=$ARM task=$TASK timeout=$TMO console=$ARM_DIR/out-console.log"
echo "run-one: archived to $RESULT_DIR"
