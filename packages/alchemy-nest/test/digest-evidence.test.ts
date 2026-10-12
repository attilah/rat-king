import { describe, expect, it } from "vitest";

import {
  emptySources,
  observeAlarms,
} from "../../../stacks/nest/alarm-sources.ts";
import type { AlarmFacts } from "../../../stacks/nest/alarm-sources.ts";

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

const digestFor = (facts: typeof AlarmFacts.Type) =>
  observeAlarms(emptySources, facts, 60_000).readings["digest.fail"];

describe("digest.fail evidence", () => {
  it("names each unavailable measurement", () => {
    expect(
      digestFor({
        ...healthy,
        failed: ["health", "readers"],
        measurementFailed: true,
      })
    ).toEqual({
      evidence: "Measurements unavailable: health, readers",
      severity: "warn",
      status: "firing",
    });
  });

  it("says the fleet digest failed when every measurement answered", () => {
    expect(digestFor({ ...healthy, digest: "fail" })).toMatchObject({
      evidence: "Fleet digest failed",
    });
  });

  it("names both when the digest failed and a measurement was missing", () => {
    expect(
      digestFor({
        ...healthy,
        digest: "fail",
        failed: ["deploy"],
        measurementFailed: true,
      })
    ).toMatchObject({
      evidence: "Fleet digest failed; Measurements unavailable: deploy",
    });
  });

  it("stays ok when everything answered", () => {
    expect(digestFor({ ...healthy, failed: [] })).toEqual({ status: "ok" });
  });
});
