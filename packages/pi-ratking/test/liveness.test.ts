// @effect-diagnostics asyncFunction:off -- fast-check asyncModelRun drives Effect programs.
import { once } from "node:events";

import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import {
  Arbitrary,
  Cause,
  Deferred,
  Effect,
  Fiber,
  Queue,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import { executeToolWithLiveness } from "../src/extension.ts";
import { callView, resultView } from "../src/tool-view.ts";
import {
  Action,
  initialPhase,
  toolProgress,
  withToolLiveness,
} from "../src/tool.ts";
import type { ToolText } from "../src/tool.ts";
import { ansiTheme } from "./view-arbitraries.ts";

const plain = (lines: readonly string[]) =>
  lines.map(stripTerminalSequences).join("\n");

const State = Schema.Struct({
  executionStarted: Schema.Boolean,
  result: Schema.Boolean,
  resultFirst: Schema.Boolean,
});

it.effect.prop(
  "queued appears exactly before execution and before any result",
  [Arbitrary.schema(State)],
  ([sample]) =>
    Effect.sync(() => {
      const context = { executionStarted: sample.executionStarted, state: {} };

      const renderResult = () => {
        resultView(
          {
            action: "send",
            details: {},
            expanded: false,
            isError: false,
            isPartial: false,
            text: "Delivered",
          },
          ansiTheme,
          undefined,
          context
        );
      };

      if (sample.result && sample.resultFirst) {
        renderResult();
      }

      const call = callView(
        "ratking",
        { action: "send", to: "peer" },
        ansiTheme,
        undefined,
        context
      );

      if (sample.result && !sample.resultFirst) {
        renderResult();
      }

      const output = plain(call.render(60));

      expect(output.includes("queued")).toBe(
        !sample.executionStarted && !sample.result
      );
      expect(output.startsWith("⋯")).toBe(
        !sample.executionStarted && !sample.result
      );
    })
);

it.effect.prop(
  "every action updates synchronously before the first await and preserves model text byte for byte",
  [
    Arbitrary.schema(
      Schema.Struct({ isError: Schema.Boolean, text: Schema.String })
    ),
  ],
  ([sample]) =>
    Effect.forEach(
      Action.literals,
      (action) =>
        Effect.gen(function* immediateUpdate() {
          const order: string[] = [];

          const promise = executeToolWithLiveness(
            initialPhase({ action, to: "peer" }),
            () =>
              Effect.sync(() => {
                order.push("action");

                return {
                  details: {},
                  isError: sample.isError,
                  text: sample.text,
                };
              }),
            (progress) => {
              order.push("update");
              expect(progress.details.phase).toBe(
                initialPhase({ action, to: "peer" })
              );
              expect(progress.text).toBe(progress.details.phase);
            }
          );

          order.push("returned");
          expect(order[0]).toBe("update");

          const result = yield* Effect.promise(async () => await promise);

          expect(result.text).toBe(sample.text);
          expect(result.isError).toBe(sample.isError);
          expect(order.indexOf("update")).toBeLessThan(
            order.indexOf("returned")
          );
          expect(order.indexOf("update")).toBeLessThan(order.indexOf("action"));
        }),
      { discard: true }
    )
);

interface TestJob {
  readonly effect: Effect.Effect<void, string>;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
}

interface LivenessModel {
  running: boolean;
  seconds: number;
}

const Lifecycle = Schema.Struct({
  action: Action,
  end: Schema.Literals(["success", "error", "abort"]),
  millis: Schema.Int.check(Schema.isBetween({ maximum: 999, minimum: 0 })),
  seconds: Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 2 })),
  text: Schema.String,
});

it.effect.prop(
  "ticks follow the clock and stop on success, failure and interruption without changing model text",
  [Arbitrary.schema(Lifecycle)],
  ([sample]) =>
    Effect.gen(function* lifecycle() {
      const done = yield* Deferred.make<ToolText, string>();
      const ready = yield* Deferred.make<boolean>();
      const updates: ToolText[] = [];

      const original: ToolText = {
        details: { id: "receipt" },
        isError: false,
        text: sample.text,
      };

      const fiber = yield* withToolLiveness(
        initialPhase({ action: sample.action, to: "peer" }),
        () =>
          Effect.gen(function* fakeAction() {
            yield* Deferred.succeed(ready, true);

            return yield* Deferred.await(done);
          }),
        (update) => {
          updates.push(update);
        }
      ).pipe(Effect.forkChild);

      yield* Deferred.await(ready);

      const jobs = yield* Queue.unbounded<TestJob>();

      yield* Stream.fromQueue(jobs).pipe(
        Stream.runForEach((job) =>
          job.effect.pipe(
            Effect.matchCause({
              onFailure: (cause) => {
                job.reject(new Error(Cause.pretty(cause)));
              },
              onSuccess: () => {
                job.resolve();
              },
            })
          )
        ),
        Effect.forkChild
      );

      const run = async (step: Effect.Effect<void, string>): Promise<void> => {
        const completion = new EventTarget();
        const failure = new AbortController();
        const promise = once(completion, "done", { signal: failure.signal });

        Queue.offerUnsafe(jobs, {
          effect: step,
          reject: (error) => {
            failure.abort(error);
          },
          resolve: () => {
            completion.dispatchEvent(new Event("done"));
          },
        });

        await promise;
      };

      const model: LivenessModel = { running: true, seconds: 0 };

      const commands: AsyncCommand<LivenessModel, readonly ToolText[]>[] =
        Array.from({ length: sample.seconds }, () => ({
          check: (state) => state.running,
          run: run.bind(
            undefined,
            Effect.gen(function* tickCommand() {
              yield* TestClock.adjust("1 second");
              model.seconds += 1;
              expect(updates.map((update) => update.details.elapsedMs)).toEqual(
                Array.from(
                  { length: model.seconds },
                  (_, index) => (index + 1) * 1000
                )
              );
            })
          ),
          toString: () => "Tick",
        }));

      const finish = Effect.gen(function* finishCommand() {
        yield* TestClock.adjust(sample.millis);

        if (sample.end === "abort") {
          yield* Fiber.interrupt(fiber);
        } else if (sample.end === "error") {
          yield* Deferred.fail(done, "failed");
          yield* Fiber.await(fiber);
        } else {
          yield* Deferred.succeed(done, original);
          const result = yield* Fiber.join(fiber);

          expect(result.text).toBe(original.text);
          expect(result.details).toEqual({
            durationMs: sample.seconds * 1000 + sample.millis,
            id: "receipt",
          });
          expect(
            plain(
              resultView(
                {
                  action: sample.action,
                  details: result.details,
                  expanded: false,
                  isError: false,
                  isPartial: false,
                  text: result.text,
                },
                ansiTheme
              ).render(60)
            )
          ).toContain(
            `${(sample.seconds + sample.millis / 1000).toFixed(1)} s`
          );
        }

        model.running = false;
      });

      commands.push(
        {
          check: (state) => state.running,
          run: run.bind(undefined, finish),
          toString: () => sample.end,
        },
        {
          check: (state) => !state.running,
          run: run.bind(
            undefined,
            Effect.gen(function* stoppedCommand() {
              const count = updates.length;

              yield* TestClock.adjust("3 seconds");
              expect(updates).toHaveLength(count);
            })
          ),
          toString: () => "TickAfterStop",
        }
      );

      yield* Effect.promise(
        asyncModelRun.bind(
          undefined,
          () => ({ model, real: updates }),
          commands
        )
      );
    })
);

const Progress = Schema.Struct({
  elapsedMs: Schema.Int.check(
    Schema.isBetween({ maximum: 600_000, minimum: 0 })
  ),
  phase: Schema.String.check(
    Schema.isPattern(/^[a-z][a-z (),0-9]{0,28}[a-z)]$/u)
  ),
});

it.effect.prop(
  "progress names its phase in the view and in plain text, with whole elapsed seconds once a second has passed",
  [Arbitrary.schema(Progress)],
  ([sample]) =>
    Effect.sync(() => {
      const progress = toolProgress(sample.phase, sample.elapsedMs);

      const output = plain(
        resultView(
          {
            action: "send",
            details: progress.details,
            expanded: false,
            isError: false,
            isPartial: true,
            text: progress.text,
          },
          ansiTheme
        ).render(80)
      );

      const seconds = `${Math.floor(sample.elapsedMs / 1000)}s`;

      expect(output).toContain(sample.phase);
      expect(progress.text.startsWith(sample.phase)).toBe(true);
      expect(output.includes(` · ${seconds}`)).toBe(sample.elapsedMs >= 1000);
      expect(progress.text.endsWith(` · ${seconds}`)).toBe(
        sample.elapsedMs >= 1000
      );
    })
);
