import json
import os
import sys
import time

directory = sys.argv[1]

def emit(value):
    print(json.dumps(value), flush=True)

def alive(pid):
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True

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
    emit({"kind": "beat", "alive": alive(pid), "text": text})
