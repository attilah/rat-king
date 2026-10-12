import { describe, expect, it } from "vitest";

import {
  emptySources,
  observeAlarms,
} from "../../../stacks/nest/alarm-sources.ts";
import type {
  AlarmFacts,
  BackupWindow,
  SourceState,
} from "../../../stacks/nest/alarm-sources.ts";

const healthy: typeof AlarmFacts.Type = {
  cacheBreaches: [],
  deploy: null,
  deployKnown: true,
  digest: "ok",
  doctor: true,
  entered: 1000,
  health: 200,
  measurementFailed: false,
  quarantinedHour: 0,
  readers: null,
  receipts: [],
  receiptsKnown: true,
  slots: { free: 100, max: 100 },
};

const restartAt = (
  entered: number,
  backup: typeof BackupWindow.Type | null
) => {
  const first = observeAlarms(emptySources, healthy, 60_000);
  const sources: typeof SourceState.Type = first.sources;

  return observeAlarms(sources, { ...healthy, backup, entered }, 200_000)
    .readings["celld.restarted"];
};

describe("backup restarts", () => {
  it("a celld start inside a running backup is explained", () => {
    expect(restartAt(120_000, { end: null, start: 100_000 })).toEqual({
      status: "ok",
    });
  });

  it("a celld start inside a finished backup is explained", () => {
    expect(restartAt(120_000, { end: 150_000, start: 100_000 })).toEqual({
      status: "ok",
    });
  });

  it("a celld start after the backup ended is not explained", () => {
    expect(restartAt(160_000, { end: 150_000, start: 100_000 })).toEqual({
      evidence:
        "1 observed process starts lack an explaining ship receipt or backup run",
      severity: "warn",
      status: "firing",
    });
  });

  it("a celld start before the backup began is not explained", () => {
    expect(restartAt(90_000, { end: null, start: 100_000 })).toMatchObject({
      status: "firing",
    });
  });

  it("with no backup window a start stays unexplained", () => {
    expect(restartAt(120_000, null)).toMatchObject({ status: "firing" });
  });
});
