import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { execute } from "../../../stacks/nest/ship-command.ts";
import type { RestartEvent } from "../../../stacks/nest/ship-config.ts";
import { deployOutcome } from "../../../stacks/nest/ship-observation.ts";

it("a deploy whose restart gate deferred reports deferred even when later steps completed", () => {
  const events: (typeof RestartEvent.Type)[] = [
    { durationSeconds: 0, phase: "requested", restarted: null },
    {
      durationSeconds: 0,
      phase: "deferred",
      restarted: false,
      retryAt: 1_792_253_848,
    },
    { durationSeconds: 0, phase: "requested", restarted: null },
    { durationSeconds: 0, phase: "completed", restarted: false },
    {
      durationSeconds: 0,
      observation: { durationSeconds: 0, restarted: false },
      phase: "completed",
      restarted: null,
    },
  ];

  expect(deployOutcome(1, events)).toEqual({
    celldRestarted: false,
    restartSeconds: 0,
    result: "deferred",
    retryAt: 1_792_253_848,
  });
  expect(deployOutcome(0, events).result).toBe("success");
});

it.effect(
  "a failed candidate that logs its cause to stdout still carries the cause in its receipt",
  () =>
    Effect.gen(function* stdoutCause() {
      const result = yield* execute(
        process.execPath,
        [
          "-e",
          "process.stdout.write('[09:08:21.954] ERROR (#2): Error: celld readiness failed at bucket write\\n');process.exitCode=1",
        ],
        process.cwd()
      ).pipe(Effect.provide(NodeServices.layer));

      expect(result.code).toBe(1);
      expect(result.stderrTail).toContain(
        "Error: celld readiness failed at bucket write"
      );
    })
);
