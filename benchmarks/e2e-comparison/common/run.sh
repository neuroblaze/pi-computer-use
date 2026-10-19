#!/bin/sh
# One benchmark arm, executed inside the smol-pi VM as:
#   PI_BENCH_TIMEOUT=2700 sh /workspace/common/run.sh <eclipse|wikipedia>
#
# The arm's extension checkout is mounted at /workspace/repo, its helper at
# /workspace/helper/linux-bridge, and everything written under /workspace/out
# lands on the host for verification.
set -u

TASK="${1:?usage: run.sh <eclipse|wikipedia>}"

export PI_COMPUTER_USE_LINUX_HELPER_PATH=/workspace/helper/linux-bridge
export NO_AT_BRIDGE=0
export GTK_MODULES=gail:atk-bridge

mkdir -p /workspace/out /workspace/sessions
rm -f /workspace/done

# Accessibility bus (the helper speaks AT-SPI over it).
/usr/libexec/at-spi-bus-launcher --launch-immediately --a11y=1 >>/workspace/out/setup.log 2>&1 &

# Task setup: bring the target app to a fresh, identical starting state.
if [ "$TASK" = "eclipse" ]; then
	rm -rf /root/bench-workspace
	# Eclipse's EPP tarball bundles its own JRE (Java 25); passing -vm with
	# the system Java 21 makes the launcher refuse to start.
	/opt/eclipse/eclipse -data /root/bench-workspace >>/workspace/out/setup.log 2>&1 &
	i=0
	while [ "$i" -lt 180 ]; do
		if xwininfo -root -tree 2>/dev/null | grep -qi "eclipse"; then break; fi
		i=$((i + 1))
		sleep 1
	done
	sleep 10
	xwininfo -root -tree >/workspace/out/windows.txt 2>&1
fi

if [ "$TASK" = "calc" ]; then
	SOFFICE="$(command -v soffice || echo /usr/lib/libreoffice/program/soffice)"
	rm -rf /root/.config/libreoffice
	SAL_USE_VCLPLUGIN=gtk3 "$SOFFICE" --calc --norestore >>/workspace/out/setup.log 2>&1 &
	i=0
	while [ "$i" -lt 180 ]; do
		if xwininfo -root -tree 2>/dev/null | grep -qi "LibreOffice Calc"; then break; fi
		i=$((i + 1))
		sleep 1
	done
	sleep 12
	xwininfo -root -tree >/workspace/out/windows.txt 2>&1
fi

date +%s > /workspace/out/start.epoch
timeout "${PI_BENCH_TIMEOUT:-2700}" pi -p \
	--provider ollama-cloud --model deepseek-v4.1-flash --thinking high \
	--no-builtin-tools -na -nc -ns -np \
	--exclude-tools ollama_web_search,ollama_web_fetch \
	--no-extensions -e /workspace/repo -e /root/.pi/agent/npm/node_modules/pi-ollama-cloud/index.ts \
	--system-prompt "$(cat /workspace/common/system-prompt.txt)" \
	--session-dir /workspace/sessions \
	"$(cat "/workspace/tasks/${TASK}.txt")" >/workspace/out/pi-stdout.log 2>&1
PI_EXIT=$?
date +%s > /workspace/out/end.epoch
echo "PI_EXIT=$PI_EXIT" >>/workspace/out/pi-stdout.log

if [ "$TASK" = "eclipse" ]; then
	cp -a /root/bench-workspace /workspace/out/workspace 2>/dev/null || true
fi
if [ "$TASK" = "calc" ]; then
	cp /root/calc-report.csv /workspace/out/calc-report.csv 2>/dev/null || true
fi
scrot -o /workspace/out/final-screen.png 2>/dev/null || true

echo done >/workspace/done
