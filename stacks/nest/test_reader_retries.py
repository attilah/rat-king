import importlib.util
import json
import pathlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("reader_retries", pathlib.Path(__file__).with_name("reader-retries.py"))
reporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reporter)


class RetryReportTest(unittest.TestCase):
    def test_fixture_snapshots_are_deduplicated_and_ranked_per_process_and_name(self):
        counts = dict.fromkeys(reporter.EVENTS, 0)
        counts["acquireMailboxUnavailable"] = 150
        counts["sendRetry"] = 2
        beat = dict(name="reader-one", pid=42, startedAt="2026-01-01T00:00:00Z",
                    updatedAt="2026-01-01T00:02:00Z", retries=dict(windowMs=60000, evictedEvents=7, buckets=[
                        dict(name="reader-one", start=60000, counts=counts),
                        dict(name="reader-one", start=120000, counts=counts),
                    ]))
        other = {**beat, "pid": 43, "retries": {**beat["retries"], "evictedEvents": 0, "buckets": [
            dict(name="reader-two", start=60000, counts={**counts, "acquireMailboxUnavailable": 90})]}}
        old = {**beat, "updatedAt": "2026-01-01T00:01:00Z", "retries": {}}
        with tempfile.TemporaryDirectory() as directory:
            fixture = pathlib.Path(directory) / "fixture.jsonl"
            fixture.write_text("\n".join(json.dumps(dict(host="fixture-host", kind="beat", text=json.dumps(value)))
                                         for value in [old, beat, beat, other]))
            output = reporter.report(reporter.records([str(fixture)]), 60000, 120000, 20)
            self.assertEqual([row["events"] for row in output["clients"]], [152, 92])
            self.assertEqual([row["name"] for row in output["clients"]], ["reader-one", "reader-two"])
            self.assertEqual(output["clients"][0]["eventsPerSecond"], 2.533)
            self.assertEqual(output["evictedEvents"], 7)
            self.assertEqual(reporter.report(reporter.records([str(fixture)]), 60001, 120000, 20)["clients"], [])
            snapshots = pathlib.Path(directory) / "retries"
            snapshots.mkdir()
            (pathlib.Path(directory) / "reader-one.json").write_text(json.dumps(beat))
            (snapshots / "42.json").write_text(json.dumps(beat))
            other["retries"]["buckets"][0]["name"] = "reader-one"
            (snapshots / "43.json").write_text(json.dumps(other))
            contested = reporter.report(reporter.records([directory]), 60000, 120000, 20)
            self.assertEqual([row["events"] for row in contested["clients"]], [152, 92])
            self.assertEqual([row["pid"] for row in contested["clients"]], [42, 43])

    def test_legacy_and_malformed_heartbeats_do_not_fabricate_zero_clients(self):
        inputs = [("fixture-host", value) for value in [{}, dict(pid=1, startedAt="x", updatedAt="invalid"),
                  dict(pid=1, startedAt="x", updatedAt="2026-01-01T00:00:00Z")]]
        self.assertEqual(reporter.report(inputs, 0, 60000, 20)["clients"], [])


if __name__ == "__main__":
    unittest.main()
