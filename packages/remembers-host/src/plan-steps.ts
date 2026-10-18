import { Failure, PlanSteps, SliceKey, emptyBooks } from "@rat-king/remembers";
import type { DeliveryValue, SliceResultValue } from "@rat-king/remembers";
import { dedupe, retryModel, sha256 } from "@rat-king/remembers/pipeline";
import { judgeStep, observerStep } from "@rat-king/remembers/steps";
import { Effect, Layer, Schedule, Schema, Semaphore } from "effect";

import { buildPlan, decodeSafeResult, validateSubmission } from "./plans.ts";
import { responseJson } from "./source-jobs.ts";

export interface PlanOptions {
  readonly at: number;
  readonly admit: () => Effect.Effect<void, Failure>;
  readonly authorize: (capability: string) => Effect.Effect<string, Failure>;
  readonly endpoint: string;
  readonly prefix: string;
  readonly rubric: string;
  readonly transport: typeof fetch;
}

const Report = Schema.Struct({
  docs: Schema.Record(Schema.String, Schema.Json),
  runId: Schema.String,
  status: Schema.String,
});

const call = Effect.fn("RemembersHost.workerCall")(function* call(
  options: PlanOptions,
  capability: string,
  input: Schema.Json
) {
  const bearer = yield* options.authorize(capability);

  const response = yield* Effect.tryPromise({
    catch: () => new Failure({ code: "transport", operation: "worker" }),
    try: options.transport.bind(
      null,
      new URL(`/${capability}`, options.endpoint),
      {
        body: JSON.stringify(input),
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    ),
  });

  return yield* responseJson(response).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Report)),
    Effect.mapError(
      () => new Failure({ code: String(response.status), operation: "worker" })
    )
  );
});

const execute = Effect.fn("RemembersHost.execute")(function* execute(
  options: PlanOptions,
  identity: DeliveryValue,
  step: ReturnType<typeof observerStep> | ReturnType<typeof judgeStep>,
  observed?: SliceResultValue
) {
  yield* options.admit();
  const runId = `remembers-${(yield* sha256(JSON.stringify(identity))).slice(0, 40)}`;
  const plan = buildPlan(step);

  const input =
    observed === undefined
      ? { plan, runId }
      : { docs: { observed }, plan, runId };

  yield* validateSubmission(input);
  let report = yield* call(options, "submitPlan", input);

  if (report.status === "running" || report.status === "waiting-for-provider") {
    report = yield* call(options, "inspectRun", { runId }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("1 second"),
        until: (value) =>
          value.status !== "running" && value.status !== "waiting-for-provider",
      })
    );
  }

  if (
    report.runId !== runId ||
    report.status !== "done" ||
    report.docs.result === undefined
  ) {
    return yield* new Failure({ code: "unfinished", operation: "worker" });
  }

  return yield* decodeSafeResult(report.docs.result);
});

export const planSteps = (options: PlanOptions) =>
  Layer.effect(
    PlanSteps,
    Effect.gen(function* bindPlanSteps() {
      const slots = yield* Semaphore.make(16);

      return PlanSteps.of({
        dedupe: (_identity, results) => dedupe(results, options.at),
        judge: Effect.fn("RemembersHost.judge")(
          function* judge(identity, candidate) {
            const serialized = identity.key.slice(
              "judge:".length,
              identity.key.lastIndexOf(":")
            );

            const key = yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(SliceKey)
            )(serialized).pipe(
              Effect.mapError(
                () => new Failure({ code: "identity", operation: "judge" })
              )
            );

            const observed = {
              books: emptyBooks(),
              candidates: [candidate],
              key,
            };

            const result = yield* execute(
              options,
              identity,
              judgeStep("observed", options.rubric, "result"),
              observed
            ).pipe(retryModel, (effect) => slots.withPermit(effect));

            if (
              JSON.stringify(result.key) !== JSON.stringify(key) ||
              result.candidates.some(
                (item) => JSON.stringify(item) !== JSON.stringify(candidate)
              )
            ) {
              return yield* new Failure({
                code: "wrong_candidate",
                operation: "judge",
              });
            }

            return { stale: false, truthful: result.candidates.length === 1 };
          }
        ),
        think: Effect.fn("RemembersHost.think")(function* think(identity, key) {
          const result = yield* execute(
            options,
            identity,
            observerStep(key, options.prefix, "result")
          ).pipe(retryModel, (effect) => slots.withPermit(effect));

          if (JSON.stringify(result.key) !== JSON.stringify(key)) {
            return yield* new Failure({
              code: "wrong_slice",
              operation: "think",
            });
          }

          return result;
        }),
      });
    })
  );
