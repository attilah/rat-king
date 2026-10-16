import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { describe, expect } from "vitest";

import {
  collectRecallCanary,
  RecallCanaryFact,
  recallCanaryReading,
} from "../../../stacks/nest/alarm-recall.ts";
import {
  emptySources,
  observeAlarms,
} from "../../../stacks/nest/alarm-sources.ts";
import type { AlarmFacts } from "../../../stacks/nest/alarm-sources.ts";

const now = Date.parse("2026-10-16T12:00:00Z");

const healthy: typeof AlarmFacts.Type = {
  cacheBreaches: [],
  deploy: null,
  deployKnown: true,
  digest: "ok",
  doctor: true,
  entered: null,
  health: 200,
  measurementFailed: false,
  quarantinedHour: 0,
  readers: null,
  receipts: [],
  receiptsKnown: true,
  slots: { free: 100, max: 100 },
};

const pass = { at: "2026-10-16T03:47:41.000Z", status: "pass" };

const receipt = (status: string) =>
  JSON.stringify({
    at: "2026-10-16T03:47:41Z",
    fingerprint: { id: "fp-1", query: "canary" },
    probes: [{ name: "recall", ok: status === "pass" }],
    schema_version: 1,
    status,
  });

describe("recall.flowing-canary reading", () => {
  it("is ok when not configured and unknown when collection failed", () => {
    expect(
      observeAlarms(emptySources, healthy, now).readings[
        "recall.flowing-canary"
      ]
    ).toEqual({ status: "ok" });
    expect(recallCanaryReading("off")).toEqual({ status: "ok" });
    expect(recallCanaryReading(null)).toEqual({ status: "unknown" });
  });

  it("fires on an ALARM file even with a pass receipt", () => {
    expect(
      recallCanaryReading({ alarm: "2026-10-16T03:40:00Z", receipt: pass })
    ).toEqual({
      evidence: "recall canary ALARM raised at 2026-10-16T03:40:00Z",
      severity: "warn",
      status: "firing",
    });
    expect(recallCanaryReading({ alarm: "present", receipt: pass })).toEqual({
      evidence: "recall canary ALARM raised at present",
      severity: "warn",
      status: "firing",
    });
  });

  it("fires when the receipt is missing, unreadable or not pass", () => {
    expect(recallCanaryReading({ alarm: null, receipt: "missing" })).toEqual({
      evidence: "no recall canary pass receipt",
      severity: "warn",
      status: "firing",
    });
    expect(recallCanaryReading({ alarm: null, receipt: "unreadable" })).toEqual(
      {
        evidence: "recall canary receipt unreadable",
        severity: "warn",
        status: "firing",
      }
    );
    expect(
      recallCanaryReading({
        alarm: null,
        receipt: { at: pass.at, status: "fail" },
      })
    ).toEqual({
      evidence: `recall canary receipt status fail at ${pass.at}`,
      severity: "warn",
      status: "firing",
    });
  });

  it.prop(
    "is ok exactly when no ALARM and a pass receipt, and never critical",
    [RecallCanaryFact],
    ([fact]) => {
      const reading = recallCanaryReading(fact);

      const status =
        fact.receipt === "missing" || fact.receipt === "unreadable"
          ? null
          : fact.receipt.status;

      const passing = fact.alarm === null && status === "pass";

      expect(reading.status).toBe(passing ? "ok" : "firing");
      expect(reading).not.toMatchObject({ severity: "critical" });
    }
  );

  it("reaches observeAlarms under its own key", () => {
    const { readings } = observeAlarms(
      emptySources,
      { ...healthy, recallCanary: { alarm: null, receipt: "missing" } },
      now
    );

    expect(readings["recall.flowing-canary"]).toMatchObject({
      severity: "warn",
      status: "firing",
    });
  });
});

describe("recall.flowing-canary collection", () => {
  it.effect("reads the exact ALARM path and the receipt's at", () =>
    Effect.gen(function* collect() {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const settings = {
        alarmFile: `${dir}/flowing-recall-canary-ALARM.json`,
        receipt: `${dir}/flowing-recall-canary-receipt.json`,
      };

      expect(yield* collectRecallCanary(settings)).toEqual({
        alarm: null,
        receipt: "missing",
      });

      yield* fs.writeFileString(settings.receipt, receipt("pass"));
      yield* fs.writeFileString(
        `${dir}/flowing-recall-canary-ALARM.cleared-2026-10-16T03:47:41Z.json`,
        JSON.stringify({
          failure_receipt: {},
          fingerprint: { id: "fp-0" },
          raised_at: "2026-10-15T22:10:00Z",
        })
      );

      const cleared = yield* collectRecallCanary(settings);

      expect(cleared).toEqual({ alarm: null, receipt: pass });
      expect(recallCanaryReading(cleared)).toEqual({ status: "ok" });

      yield* fs.writeFileString(settings.receipt, receipt("fail"));

      expect(yield* collectRecallCanary(settings)).toEqual({
        alarm: null,
        receipt: { at: pass.at, status: "fail" },
      });

      yield* fs.writeFileString(
        settings.alarmFile,
        JSON.stringify({
          failure_receipt: {},
          fingerprint: { id: "fp-1" },
          raised_at: "2026-10-16T04:00:00Z",
        })
      );
      yield* fs.writeFileString(settings.receipt, "{not json");

      expect(yield* collectRecallCanary(settings)).toEqual({
        alarm: "2026-10-16T04:00:00Z",
        receipt: "unreadable",
      });

      yield* fs.writeFileString(settings.alarmFile, "{not json");

      expect(yield* collectRecallCanary(settings)).toMatchObject({
        alarm: "present",
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
