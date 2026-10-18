import { StepFailed, callable, planRunWorker } from "@mischief/worker";
import type { Callable } from "@mischief/worker";
import { Effect, Schema } from "effect";

import {
  Count,
  Delivery,
  Draft,
  MemoryRecord,
  Slice,
  SliceResult,
  SliceSource,
  Store,
  Verdict,
} from "../src/contract.ts";
import type { CanonSource } from "../src/contract.ts";
import { dedupe, postObservation } from "../src/pipeline.ts";

const SliceInput = Schema.Struct({
  conversation: Schema.NonEmptyString,
  first: Schema.NonEmptyString,
  last: Schema.NonEmptyString,
});

const Drafts = Schema.Array(Draft);

const Answer = Schema.Union([Schema.fromJsonString(Drafts), Drafts]);

const JudgeBatch = Schema.Array(
  Schema.Struct({ ...Verdict.fields, index: Count })
);

const JudgeEphemeral = Schema.Struct({ result: SliceResult, slice: Slice });

export const workerCallables = Effect.fn("Remembers.workerCallables")(
  function* workerCallables() {
    const store = yield* Store;
    const source = yield* SliceSource;
    const canon = yield* Effect.context<CanonSource>();

    return [
      [
        "remembers-slice",
        callable({
          input: SliceInput,
          output: Slice,
          run: (input, call) =>
            source
              .read({
                conversation: input.conversation,
                first_chunk: input.first,
                last_chunk: input.last,
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new StepFailed({
                      key: call.key,
                      reason:
                        "Slice unavailable; repair the read-only source and retry.",
                    })
                )
              ),
        }),
      ],
      [
        "remembers-observed",
        callable({
          input: Schema.Struct({ answer: Answer, ephemeral: Slice }),
          output: SliceResult,
          run: (input, call) =>
            postObservation(input.ephemeral, input.answer).pipe(
              Effect.provide(canon),
              Effect.mapError(
                () =>
                  new StepFailed({
                    key: call.key,
                    reason:
                      "Observation post-processing failed; check the private output contract and retry.",
                  })
              )
            ),
        }),
      ],
      [
        "remembers-judge-input",
        callable({
          input: Schema.Record(Schema.String, SliceResult).check(
            Schema.makeFilter((docs) => Object.keys(docs).length === 1)
          ),
          output: JudgeEphemeral,
          run: (input, call) =>
            Effect.gen(function* judgeInput() {
              const [result] = Object.values(input);

              if (result === undefined) {
                return yield* new StepFailed({
                  key: call.key,
                  reason: "Judge needs one safe observation result doc.",
                });
              }

              const slice = yield* source.read(result.key).pipe(
                Effect.mapError(
                  () =>
                    new StepFailed({
                      key: call.key,
                      reason:
                        "Judge source unavailable; repair read access and retry.",
                    })
                )
              );

              return { result, slice };
            }),
        }),
      ],
      [
        "remembers-judged",
        callable({
          input: Schema.Struct({
            answer: Schema.Union([
              Schema.fromJsonString(JudgeBatch),
              JudgeBatch,
            ]),
            ephemeral: JudgeEphemeral,
          }),
          output: SliceResult,
          run: (input) =>
            Effect.sync(() => {
              const candidates = input.ephemeral.result.candidates.filter(
                (_candidate, index) =>
                  input.answer.some(
                    (verdict) =>
                      verdict.index === index &&
                      verdict.truthful &&
                      !verdict.stale
                  )
              );

              return {
                ...input.ephemeral.result,
                books: {
                  ...input.ephemeral.result.books,
                  gated_in: candidates.length,
                },
                candidates,
              };
            }),
        }),
      ],
      [
        "remembers-dedupe",
        callable({
          input: Schema.Struct({
            at: Count,
            results: Schema.Array(SliceResult),
          }),
          output: Schema.Array(MemoryRecord),
          run: (input, call) =>
            dedupe(input.results, input.at).pipe(
              Effect.mapError(
                () =>
                  new StepFailed({
                    key: call.key,
                    reason:
                      "Dedupe failed; check safe slice results and retry.",
                  })
              )
            ),
        }),
      ],
      [
        "remembers-store",
        callable({
          input: Schema.Array(MemoryRecord),
          output: Count,
          run: (input, call) =>
            Schema.decodeEffect(Delivery)(call).pipe(
              Effect.flatMap((identity) => store.commit(identity, input)),
              Effect.mapError(
                () =>
                  new StepFailed({
                    key: call.key,
                    reason:
                      "Store failed; check project cell binding and retry the same delivery tuple.",
                  })
              )
            ),
        }),
      ],
    ] satisfies Iterable<readonly [string, Callable]>;
  }
);

export const composeWorker = workerCallables().pipe(
  Effect.map((callables) => planRunWorker({ callables }))
);

export { observerStep, judgeStep } from "../src/steps.ts";
