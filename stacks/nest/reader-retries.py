"""Read-only retry report. Inputs: heartbeat directories, JSON files, or JSONL
from reader-heartbeats.py (optionally wrap each record with a `host` field).
Only complete 60-second buckets inside [--since, --until) are summed. Repeated
snapshots are deduplicated by host/pid/startedAt, taking the newest updatedAt.
History is bounded to 60 name/window buckets per process, not a durable archive.
"""
import argparse
import datetime
import json
import os

EVENTS = (
    "acquireOk", "acquireLeaseHeld", "acquireMailboxUnavailable", "acquireTimeout", "acquireOther",
    "renewLeaseHeld", "renewMailboxUnavailable", "renewTimeout", "renewLeaseExpired", "renewLeaseMismatch", "renewOther",
    "consumeReconnect", "sendRetry",
)


def epoch(text):
    return int(datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)


def records(paths):
    for path in paths:
        directories = [path]
        if os.path.isdir(os.path.join(path, "retries")):
            directories.append(os.path.join(path, "retries"))
        files = [os.path.join(directory, name) for directory in directories for name in sorted(os.listdir(directory))
                 if name.endswith(".json") and not name.startswith(".")] if os.path.isdir(path) else [path]
        default_host = os.path.abspath(path if os.path.isdir(path) else os.path.dirname(path))
        for file in files:
            try:
                with open(file, encoding="utf-8") as source:
                    for line in source:
                        # Same per-heartbeat bound as reader-heartbeats.py.
                        if len(line) > 65536:
                            continue
                        try:
                            record = json.loads(line)
                            host = record.get("host", default_host)
                            if record.get("kind") == "beat":
                                record = json.loads(record["text"])
                            yield host, record
                        except (ValueError, KeyError, TypeError, AttributeError):
                            continue
            except OSError:
                continue


def report(inputs, since, until, top):
    latest = {}
    for host, beat in inputs:
        try:
            key = (host, beat["pid"], beat["startedAt"])
            updated = epoch(beat["updatedAt"])
            if key not in latest or updated > latest[key][0]:
                latest[key] = (updated, beat)
        except (ValueError, KeyError, TypeError):
            continue
    clients = {}
    evicted = 0
    for (host, pid, started), (_, beat) in latest.items():
        retries = beat.get("retries", {})
        if not isinstance(retries, dict) or retries.get("windowMs") != 60000:
            continue
        buckets = retries.get("buckets", [])
        if not isinstance(buckets, list) or len(buckets) > 60:
            continue
        dropped = retries.get("evictedEvents", 0)
        if isinstance(dropped, int) and dropped >= 0:
            evicted += dropped
        seen = set()
        for bucket in buckets:
            try:
                start, name, counts = bucket["start"], bucket["name"], bucket["counts"]
                if not isinstance(start, int) or start % 60000 or not isinstance(name, str):
                    continue
                if start < since or start + 60000 > until or (name, start) in seen:
                    continue
                if not isinstance(counts, dict) or any(type(counts.get(event)) is not int or counts[event] < 0 for event in EVENTS):
                    continue
                seen.add((name, start))
                key = (host, pid, started, name)
                row = clients.setdefault(key, dict(host=host, pid=pid, startedAt=started, name=name,
                                                  counts=dict.fromkeys(EVENTS, 0), windows=0, peakEventsPerSecond=0))
                row["windows"] += 1
                row["peakEventsPerSecond"] = max(row["peakEventsPerSecond"], round(sum(counts[event] for event in EVENTS) / 60, 3))
                for event in EVENTS:
                    row["counts"][event] += counts[event]
            except (ValueError, KeyError, TypeError):
                continue
    for row in clients.values():
        row["events"] = sum(row["counts"].values())
        row["eventsPerSecond"] = round(row["events"] / ((until - since) / 1000), 3)
    return dict(since=since, until=until, windowMs=60000, evictedEvents=evicted,
                coverage="retained complete buckets only; missing heartbeats and evicted history are not zero",
                clients=sorted(clients.values(), key=lambda row: (-row["events"], row["host"], row["name"], row["pid"]))[:top])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--since", required=True, help="ISO timestamp, inclusive")
    parser.add_argument("--until", required=True, help="ISO timestamp, exclusive")
    parser.add_argument("--top", type=int, default=20)
    args = parser.parse_args()
    since, until = epoch(args.since), epoch(args.until)
    if since >= until or args.top <= 0:
        parser.error("require since < until and top > 0")
    print(json.dumps(report(records(args.paths), since, until, args.top), indent=2))


if __name__ == "__main__":
    main()
