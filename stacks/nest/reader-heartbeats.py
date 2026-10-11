import datetime
import json
import os
import subprocess
import sys
import time

directory = sys.argv[1]

def emit(value):
    print(json.dumps(value), flush=True)

REUSE_SLACK_SECONDS = 120

def elapsed_seconds(pid):
    try:
        out = subprocess.run(["ps", "-o", "etime=", "-p", str(pid)], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not out:
        return None
    days, _, clock = out.rpartition("-")
    parts = [int(part) for part in clock.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return (int(days) if days else 0) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]

def started_epoch(text):
    try:
        value = json.loads(text).get("startedAt")
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, TypeError, ValueError):
        return None

def alive(pid, started):
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    elapsed = elapsed_seconds(pid)
    if elapsed is None or started is None:
        return elapsed is not None
    return time.time() - elapsed <= started + REUSE_SLACK_SECONDS

emit({"kind": "now", "now": int(time.time() * 1000)})
if not os.path.isdir(directory):
    sys.exit(0)
for name in sorted(os.listdir(directory)):
    if name.startswith(".") or not name.endswith(".json"):
        continue
    try:
        with open(os.path.join(directory, name)) as source:
            text = source.read(65536)
        pid = json.loads(text).get("pid")
    except (OSError, ValueError, AttributeError):
        continue
    emit({"kind": "beat", "alive": alive(pid, started_epoch(text)), "text": text})
