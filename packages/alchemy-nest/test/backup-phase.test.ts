import { it } from "@effect/vitest";
import {
  Arbitrary,
  Duration,
  Effect,
  Exit,
  Fiber,
  Logger,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { phase } from "../../../stacks/nest/backup.ts";

const Elapsed = Schema.Int.check(
  Schema.isBetween({ maximum: 120_000, minimum: 0 })
);

const run = (elapsed: number, outcome: "fail" | "succeed") => {
  const lines: string[] = [];

  const capture = Logger.layer([
    Logger.make(({ message }) => {
      lines.push((Array.isArray(message) ? message : [message]).join(" "));
    }),
  ]);

  return Effect.gen(function* measure() {
    const fiber = yield* phase(
      "stop-store",
      Effect.sleep(Duration.millis(elapsed)).pipe(
        Effect.andThen(
          outcome === "fail" ? Effect.fail("stop failed") : Effect.void
        )
      )
    ).pipe(Effect.exit, Effect.forkChild);

    yield* TestClock.adjust(Duration.millis(elapsed));
    const exit = yield* Fiber.join(fiber);

    return { exit, lines };
  }).pipe(Effect.provide(capture));
};

it.effect.prop(
  "a phase logs its own elapsed milliseconds whether it succeeds or fails",
  [
    Arbitrary.schema(Elapsed),
    Arbitrary.schema(Schema.Literals(["fail", "succeed"])),
  ],
  ([elapsed, outcome]) =>
    Effect.gen(function* proof() {
      const { exit, lines } = yield* run(elapsed, outcome);

      expect(lines).toEqual([`BACKUP_PHASE stop-store ${elapsed}`]);
      expect(Exit.isFailure(exit)).toBe(outcome === "fail");
    })
);
