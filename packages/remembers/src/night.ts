import { watchActor } from "@rat-king/capability/actor-watch";
import { createEffectActor, createEffectLogic, waitFor } from "@xstate/effect";
import { Effect, Exit, Ref, Schema } from "effect";
import { setup } from "xstate";

import type {
  CandidateValue,
  DeliveryValue,
  MemoryRecordValue,
  RunBooksValue,
  SliceResultValue,
} from "./contract.ts";
import {
  Failure,
  DefectSignature,
  MemoryRecord,
  Page,
  PlanSteps,
  Recheck,
  SliceResult,
  SliceSource,
  Speaks,
  Store,
  Verdict,
  emptyBooks,
} from "./contract.ts";

export const NightConfig = Schema.Struct({
  at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  concurrency: Schema.Int.check(Schema.isGreaterThan(0)),
  epoch: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  owner: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  visit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type NightConfigValue = typeof NightConfig.Type;

const delivery = (config: NightConfigValue, key: string): DeliveryValue => ({
  epoch: config.epoch,
  key,
  runId: config.runId,
  visit: config.visit,
});

const sumBooks = (results: readonly SliceResultValue[]): RunBooksValue => {
  const sum = (key: keyof RunBooksValue) =>
    results.reduce((total, result) => total + result.books[key], 0);

  return {
    cite_failed: sum("cite_failed"),
    cites_verified: sum("cites_verified"),
    dedupe_merges: sum("dedupe_merges"),
    defects_fired: sum("defects_fired"),
    failed_slices: sum("failed_slices"),
    gated_in: sum("gated_in"),
    novelty_dropped: sum("novelty_dropped"),
    observed: sum("observed"),
    privacy_dropped: sum("privacy_dropped"),
    slices_read: sum("slices_read"),
    stored: sum("stored"),
    unsafe_dropped: sum("unsafe_dropped"),
  };
};

const gateSlice = Effect.fn("Remembers.gateSlice")(function* gateSlice(
  result: SliceResultValue,
  config: NightConfigValue
) {
  const steps = yield* PlanSteps;
  const candidates: CandidateValue[] = [];

  for (const [index, candidate] of result.candidates.entries()) {
    const verdict = yield* steps
      .judge(
        delivery(config, `judge:${JSON.stringify(result.key)}:${index}`),
        candidate
      )
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Verdict)),
        Effect.mapError(
          () => new Failure({ code: "verdict", operation: "judge" })
        )
      );

    if (verdict.truthful && !verdict.stale) {
      candidates.push(candidate);
    }
  }

  return {
    ...result,
    books: { ...result.books, gated_in: candidates.length },
    candidates,
  };
});

const clusterDefects = Effect.fn("Remembers.clusterDefects")(
  function* clusterDefects(config: NightConfigValue) {
    const source = yield* SliceSource;
    const store = yield* Store;
    const speaks = yield* Speaks;
    let fired = 0;

    for (const defect of yield* store.defects()) {
      if (!Schema.is(DefectSignature)(defect.signature.literal)) {
        continue;
      }

      if (yield* store.fired(defect.id)) {
        continue;
      }

      const conversations = yield* source.defectCount(
        defect,
        Math.max(0, config.at - 7 * 86_400_000)
      );

      if (conversations < 3 && defect.impact < 3) {
        continue;
      }

      yield* speaks.send({
        encrypted: true,
        id: `defect:${defect.id}`,
        kind: "defect",
        payload: JSON.stringify({ conversations, defect }),
        to: defect.owner,
      });
      yield* store.markFired(defect.id);
      fired += 1;
    }

    return fired;
  }
);

export const auditOwed = Effect.fn("Remembers.auditOwed")(function* auditOwed(
  owner: string
) {
  const store = yield* Store;
  const speaks = yield* Speaks;

  for (const runId of yield* store.owed()) {
    yield* speaks.send({
      encrypted: true,
      id: `alarm:${runId}`,
      kind: "alarm",
      payload: JSON.stringify({ runId }),
      to: owner,
    });
  }
});

export const runNight = Effect.fn("Remembers.runNight")(
  function* runNight(
    input: Omit<NightConfigValue, "concurrency" | "epoch" | "visit"> & {
      readonly concurrency?: number;
      readonly epoch?: number;
      readonly visit?: number;
    }
  ) {
    const config = yield* Schema.decodeEffect(NightConfig)({
      ...input,
      concurrency: input.concurrency ?? 16,
      epoch: input.epoch ?? 0,
      visit: input.visit ?? 0,
    }).pipe(
      Effect.mapError(() => new Failure({ code: "config", operation: "night" }))
    );

    const store = yield* Store;
    const source = yield* SliceSource;
    const steps = yield* PlanSteps;
    const recheck = yield* Recheck;
    const speaks = yield* Speaks;
    yield* auditOwed(config.owner);
    yield* store.start(config.runId);
    const page = yield* Ref.make<typeof Page.Type>({ cursor: "", keys: [] });
    const results = yield* Ref.make<readonly SliceResultValue[]>([]);
    const records = yield* Ref.make<readonly MemoryRecordValue[]>([]);
    const books = yield* Ref.make(emptyBooks());

    const cursorEffect = Effect.gen(function* cursorStage() {
      const next = yield* source.page(yield* store.cursor()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Page)),
        Effect.mapError(
          () => new Failure({ code: "page", operation: "cursor" })
        )
      );

      yield* Ref.set(page, next);
    });

    const slicesEffect = Effect.gen(function* slicesStage() {
      const next = yield* Ref.get(page);

      const settled = yield* Effect.forEach(
        next.keys,
        (key) =>
          steps
            .think(delivery(config, `think:${JSON.stringify(key)}`), key)
            .pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(SliceResult)),
              Effect.mapError(
                () => new Failure({ code: "slice", operation: "think" })
              ),
              Effect.flatMap((result) => gateSlice(result, config)),
              Effect.orElseSucceed(() => ({
                books: { ...emptyBooks(), failed_slices: 1 },
                candidates: [],
                key,
              }))
            ),
        { concurrency: config.concurrency }
      );

      yield* Ref.set(results, settled);
    });

    const pipelineEffect = Effect.gen(function* pipelineStage() {
      const slices = yield* Ref.get(results);

      const merged = yield* steps
        .dedupe(delivery(config, "dedupe"), slices)
        .pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Array(MemoryRecord))
          ),
          Effect.mapError(
            () => new Failure({ code: "records", operation: "dedupe" })
          )
        );

      yield* Ref.set(records, merged);

      const stored = yield* store.commit(delivery(config, "store"), merged);

      for (const record of merged) {
        yield* recheck.arm(record, delivery(config, `recheck:${record.id}`));
      }

      const summed = sumBooks(slices);
      yield* Ref.set(books, {
        ...summed,
        dedupe_merges: summed.gated_in - merged.length,
        stored,
      });
    });

    const booksEffect = Effect.gen(function* booksStage() {
      const defects_fired = yield* clusterDefects(config);
      yield* Ref.update(books, (current) => ({ ...current, defects_fired }));
    });

    const reportEffect = Effect.gen(function* reportStage() {
      const proof = yield* Ref.get(books);
      const next = yield* Ref.get(page);

      const sample = (yield* Ref.get(records)).slice(0, 10).map((record) => ({
        cites: record.cites,
        id: record.id,
        sentence: record.claim.sentence,
      }));

      yield* speaks.send({
        encrypted: true,
        id: `report:${config.runId}`,
        kind: "report",
        payload: JSON.stringify({
          books: proof,
          cursor: next.cursor,
          runId: config.runId,
          sample: sample.map((item) => item.sentence),
          sample_cites: sample,
        }),
        to: config.owner,
      });

      if (proof.failed_slices > 0) {
        return yield* Effect.fail(
          new Failure({ code: "partial", operation: "report" })
        );
      }

      return yield* store.finish(config.runId, next.cursor, proof);
    });

    const schemas = { input: Schema.Void, output: Schema.Void };

    const machine = setup({
      actors: {
        books: createEffectLogic({ effect: () => booksEffect, schemas }),
        cursor: createEffectLogic({ effect: () => cursorEffect, schemas }),
        pipeline: createEffectLogic({ effect: () => pipelineEffect, schemas }),
        report: createEffectLogic({ effect: () => reportEffect, schemas }),
        slices: createEffectLogic({ effect: () => slicesEffect, schemas }),
      },
    }).createMachine({
      initial: "cursor",
      states: {
        alarm: { type: "final" },
        books: {
          invoke: {
            onDone: { target: "reportOwed" },
            onError: { target: "alarm" },
            src: "books",
          },
        },
        complete: { type: "final" },
        cursor: {
          invoke: {
            onDone: { target: "slices" },
            onError: { target: "alarm" },
            src: "cursor",
          },
        },
        pipeline: {
          invoke: {
            onDone: { target: "books" },
            onError: { target: "alarm" },
            src: "pipeline",
          },
        },
        reportOwed: {
          invoke: {
            onDone: { target: "complete" },
            onError: { target: "alarm" },
            src: "report",
          },
        },
        slices: {
          invoke: {
            onDone: { target: "pipeline" },
            onError: { target: "alarm" },
            src: "slices",
          },
        },
      },
    });

    const actor = yield* createEffectActor(machine);
    yield* watchActor("remembers-night", actor);

    const final = yield* waitFor(
      actor,
      (snapshot) => snapshot.status === "done"
    );

    if (final.matches("alarm")) {
      yield* auditOwed(config.owner);

      return yield* Effect.fail(
        new Failure({ code: "report_owed", operation: "night" })
      );
    }

    return yield* Ref.get(books);
  },
  Effect.scoped,
  (effect, input) =>
    effect.pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? auditOwed(input.owner) : Effect.void
      )
    )
);
