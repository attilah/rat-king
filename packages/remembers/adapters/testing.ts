import { Context, Effect, Layer, Ref } from "effect";

import { codePoints } from "../src/code-points.ts";
import {
  CanonSource,
  Failure,
  Judge,
  Observer,
  PlanSteps,
  Recheck,
  SliceSource,
  Speaks,
} from "../src/contract.ts";
import type {
  DraftValue,
  MemoryRecordValue,
  NoticeValue,
  SliceValue,
  Verdict,
} from "../src/contract.ts";
import { dedupe, observeSlice, retryModel } from "../src/pipeline.ts";
import { nodeCells } from "./node-sqlite.ts";
import { sqliteStore } from "./sqlite.ts";

export interface Fixture {
  readonly at: number;
  readonly canon: readonly string[];
  readonly counts: ReadonlyMap<string, number>;
  readonly drafts: ReadonlyMap<string, readonly DraftValue[]>;
  readonly failReport?: boolean;
  readonly projects: readonly string[];
  readonly slices: readonly SliceValue[];
  readonly unavailableQuotes?: boolean;
  readonly verdicts?: ReadonlyMap<string, typeof Verdict.Type>;
}

export class TestProbe extends Context.Service<
  TestProbe,
  {
    readonly journal: () => Effect.Effect<readonly string[]>;
    readonly notices: () => Effect.Effect<readonly NoticeValue[]>;
    readonly wakes: () => Effect.Effect<readonly MemoryRecordValue[]>;
  }
>()("remembers/TestProbe") {}

export const testPorts = (fixture: Fixture) =>
  Layer.effectContext(
    Effect.gen(function* makeTestPorts() {
      const journal = yield* Ref.make<readonly string[]>([]);
      const notices = yield* Ref.make<readonly NoticeValue[]>([]);
      const wakes = yield* Ref.make<readonly MemoryRecordValue[]>([]);

      const trace = (text: string) =>
        Ref.update(journal, (entries) => [...entries, text]);

      const observer = Observer.of({
        think: (slice) =>
          Effect.succeed(fixture.drafts.get(slice.key.conversation) ?? []),
      });

      const judge = Judge.of({
        judge: (candidate) =>
          Effect.succeed(
            fixture.verdicts?.get(candidate.claim.sentence) ?? {
              stale: false,
              truthful: true,
            }
          ),
      });

      const source = SliceSource.of({
        defectCount: (defect) =>
          Effect.succeed(fixture.counts.get(defect.id) ?? 0),
        page: (cursor) =>
          Effect.succeed({
            cursor: String(fixture.slices.length),
            keys:
              cursor === String(fixture.slices.length)
                ? []
                : fixture.slices.map((slice) => slice.key),
          }),
        quote: (cite) =>
          Effect.succeed(
            fixture.unavailableQuotes === true
              ? null
              : (fixture.slices
                  .flatMap((slice) => slice.chunks)
                  .filter((chunk) => chunk.id === cite.chunk_id)
                  .map((chunk) =>
                    codePoints(chunk.text).slice(cite.start, cite.end).join("")
                  )[0] ?? null)
          ),
        read: (key) => {
          const slice = fixture.slices.find(
            (item) => JSON.stringify(item.key) === JSON.stringify(key)
          );

          return slice
            ? Effect.succeed(slice)
            : Effect.fail(new Failure({ code: "missing", operation: "read" }));
        },
      });

      const canon = CanonSource.of({
        loaded: () => Effect.succeed(fixture.canon),
        states: (claim, loaded) =>
          Effect.succeed(loaded.some((text) => text.includes(claim.sentence))),
      });

      const context = Context.make(SliceSource, source).pipe(
        Context.add(Observer, observer),
        Context.add(Judge, judge),
        Context.add(CanonSource, canon)
      );

      const steps = PlanSteps.of({
        dedupe: (identity, results) =>
          Effect.gen(function* testDedupe() {
            yield* trace(JSON.stringify({ identity, input: results }));
            const output = yield* dedupe(results, fixture.at);
            yield* trace(JSON.stringify({ identity, output }));

            return output;
          }),
        judge: (identity, candidate) =>
          trace(JSON.stringify({ identity, input: candidate })).pipe(
            Effect.andThen(retryModel(judge.judge(candidate)))
          ),
        think: (identity, key) =>
          Effect.gen(function* testThink() {
            yield* trace(JSON.stringify({ identity, input: key }));

            const output = yield* observeSlice(key).pipe(
              Effect.provide(context)
            );

            yield* trace(JSON.stringify({ identity, output }));

            return output;
          }),
      });

      return context.pipe(
        Context.add(PlanSteps, steps),
        Context.add(
          Recheck,
          Recheck.of({
            arm: (record) =>
              Ref.update(wakes, (current) =>
                current.some((entry) => entry.id === record.id)
                  ? current
                  : [...current, record]
              ),
          })
        ),
        Context.add(
          Speaks,
          Speaks.of({
            send: (notice) => {
              if (fixture.failReport === true && notice.kind === "report") {
                return Effect.fail(
                  new Failure({ code: "transport", operation: "report" })
                );
              }

              return Ref.update(notices, (current) =>
                current.some((entry) => entry.id === notice.id)
                  ? current
                  : [...current, notice]
              );
            },
          })
        ),
        Context.add(
          TestProbe,
          TestProbe.of({
            journal: () => Ref.get(journal),
            notices: () => Ref.get(notices),
            wakes: () => Ref.get(wakes),
          })
        )
      );
    })
  );

export const testLayer = (fixture: Fixture) =>
  Layer.mergeAll(
    testPorts(fixture),
    sqliteStore.pipe(
      Layer.provideMerge(
        nodeCells(
          ":memory:",
          new Map(fixture.projects.map((project) => [project, ":memory:"]))
        )
      )
    )
  );
