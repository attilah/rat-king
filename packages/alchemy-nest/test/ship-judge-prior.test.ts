import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { judgeShip, restartReason } from "../../../stacks/nest/ship-judge.ts";
import type {
  JudgeHealth,
  WindowFacts,
} from "../../../stacks/nest/ship-judge.ts";

const window: WindowFacts = {
  ackLatency: { p50: 4509, p95: 21_000 },
  acked: 31,
  delivered: 31,
  deliveryLatency: { p50: 25, p95: 49 },
  end: "2026-10-18T15:47:37.896Z",
  replays: 0,
  sent: 31,
  start: "2026-10-18T15:37:37.896Z",
  undelivered: 0,
  undeliveredRecipients: [],
};

const listeners = { count: 10, expected: 10 };

const health = (
  status: JudgeHealth["status"],
  reasons: readonly string[]
): JudgeHealth => ({ listeners, reasons, status });

const tagOf = (input: {
  readonly after: JudgeHealth;
  readonly prior: JudgeHealth | null;
  readonly restarted?: boolean;
}) =>
  judgeShip({
    after: window,
    baseline: window,
    health: input.after,
    prior: input.prior,
    restarted: input.restarted ?? false,
    sha: "b".repeat(40),
  })._tag;

const backupStop = "backup stop 80959 ms";

it.effect("a warning present before the ship is not a revert trigger", () =>
  Effect.sync(() => {
    const before = health("warn", [restartReason, backupStop]);

    expect(tagOf({ after: health("warn", [backupStop]), prior: before })).toBe(
      "Pass"
    );

    expect(
      tagOf({ after: health("warn", ["backup stop 81002 ms"]), prior: before })
    ).toBe("Pass");
  })
);

it.effect("a new warning after the ship fails", () =>
  Effect.sync(() => {
    const before = health("warn", [backupStop]);

    expect(
      tagOf({
        after: health("warn", [backupStop, "storage slots low"]),
        prior: before,
      })
    ).toBe("Fail");

    expect(
      tagOf({
        after: health("warn", ["storage slots low"]),
        prior: health("ok", []),
      })
    ).toBe("Fail");
  })
);

it.effect("a planned restart explains only the restart warning", () =>
  Effect.sync(() => {
    const before = health("warn", [backupStop]);
    const after = health("warn", [restartReason, backupStop]);

    expect(tagOf({ after, prior: before, restarted: true })).toBe("Pass");
    expect(tagOf({ after, prior: before, restarted: false })).toBe("Fail");
  })
);

it.effect("without a prior snapshot any non-ok status still fails", () =>
  Effect.sync(() => {
    expect(tagOf({ after: health("warn", [backupStop]), prior: null })).toBe(
      "Fail"
    );

    expect(tagOf({ after: health("ok", []), prior: null })).toBe("Pass");
  })
);

it.effect("without reasons a worsened status fails and a held one passes", () =>
  Effect.sync(() => {
    const bare = (status: JudgeHealth["status"]): JudgeHealth => ({
      listeners,
      status,
    });

    expect(tagOf({ after: bare("fail"), prior: bare("warn") })).toBe("Fail");
    expect(tagOf({ after: bare("warn"), prior: bare("warn") })).toBe("Pass");
  })
);
