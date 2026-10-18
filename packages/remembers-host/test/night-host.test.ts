import { it } from "@effect/vitest";
import type { Speaks } from "@rat-king/remembers";
import {
  Failure,
  Recheck,
  SliceSource,
  Store,
  emptyBooks,
} from "@rat-king/remembers";
import { runNight } from "@rat-king/remembers/night";
import { nodeCells } from "@rat-king/remembers/node-sqlite";
import type { SqlCells } from "@rat-king/remembers/sqlite";
import { sqliteStore } from "@rat-king/remembers/sqlite";
import {
  Arbitrary,
  Effect,
  Exit,
  Function as Fn,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { expect } from "vitest";

import { completedRun } from "../src/cells.ts";
import type { HostConfig } from "../src/config.ts";
import { NoticeTransport, durableSpeaks } from "../src/notices.ts";
import { planSteps } from "../src/plan-steps.ts";
import { Submission } from "../src/plans.ts";
import { catchUp, dayMillis } from "../src/scheduler.ts";
import {
  cursorJob,
  defectCountJob,
  promisedResponse,
} from "../src/source-jobs.ts";
import { supervisor } from "../src/supervisor.ts";

const key = (day: number) => ({
  conversation: `conversation-${day}`,
  first_chunk: `chunk-${day}`,
  last_chunk: `chunk-${day}`,
});

const failure = () =>
  Effect.fail(new Failure({ code: "ephemeral_only", operation: "test" }));

const result = (day: number) =>
  ({
    books: { ...emptyBooks(), cites_verified: 1, observed: 1, slices_read: 1 },
    candidates: [
      {
        cites: [
          {
            chunk_id: `chunk-${day}`,
            end: 8,
            sha256: "a".repeat(64),
            start: 0,
          },
        ],
        claim: {
          concepts: ["fixture"],
          defect: null,
          kind: "decision",
          privacy: "private",
          project: "orchid",
          recheck: "commit",
          sentence: `Use a bounded fixture window ${day}.`,
          type: "decision",
        },
        subject: { fixture: day },
      },
    ],
    key: key(day),
  }) as const;

const canaryConfig = (): HostConfig => ({
  canary: key(1),
  canon: ["Invented always-loaded canon."],
  canonPaths: "[]",
  epoch: 0,
  from: Option.none(),
  idleMs: 1000,
  mailbox: "/srv/example/mailbox.json",
  mode: "canary",
  observer: "/srv/example/observer.txt",
  owner: "fixture",
  prefix: "invented observer",
  projects: ["orchid"],
  root: "/srv/example",
  rubric: "invented judge",
  sliceBearer: Redacted.make("invented"),
  sliceUrl: "https://slice.invalid",
  threshold: 1_000_000,
  through: Option.none(),
  workerDid: "did:example:worker",
  workerUrl: "https://worker.invalid",
});

it.effect.prop(
  "three catch-up days use the real night and SQLite; only completed days move the cursor; raw worker output never reaches stores or notices",
  {
    mode: Arbitrary.schema(
      Schema.Literals(["success", "failed", "raw", "canary", "off"])
    ),
  },
  ({ mode }) =>
    Effect.gen(function* night() {
      const sent: string[] = [];
      const modelCalls: string[] = [];

      const transport: typeof fetch = Fn.flow(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input).url);

          if (url.pathname === "/count") {
            return Response.json({ by_day: [], conversations: 0 });
          }

          if (url.pathname === "/chunks") {
            const after = Number(url.searchParams.get("after"));

            const items = [1, 2, 3].flatMap((day) =>
              day > after
                ? [
                    {
                      chunk_id: `chunk-${day}`,
                      conversation: `conversation-${day}`,
                      role: "user",
                      rowid: day,
                      started_at: (day - 1) * dayMillis + 1,
                      token_count: 1,
                    },
                  ]
                : []
            );

            return Response.json({ items, next: items.at(-1)?.rowid ?? after });
          }

          const body = Schema.decodeUnknownSync(Schema.String)(init?.body);

          const submitted = Schema.decodeUnknownSync(
            Schema.fromJsonString(Submission)
          )(body);

          const { step } = submitted.plan.machine.states.work.meta;

          const day =
            step.ephemeral.capability === "remembers-slice"
              ? Number(step.ephemeral.input.conversation.split("-").at(-1))
              : Number(
                  submitted.docs?.observed.key.conversation.split("-").at(-1)
                );

          modelCalls.push(submitted.runId);

          if (mode === "failed" && day === 2) {
            return Response.json(
              { error: "invented failure" },
              { status: 500 }
            );
          }

          const output =
            mode === "raw"
              ? {
                  ...result(day),
                  chunks: [{ text: "invented forbidden evidence" }],
                }
              : result(day);

          return Response.json({
            docs: { result: output },
            runId: submitted.runId,
            status: "done",
          });
        },
        promisedResponse
      );

      const notices = Layer.succeed(
        NoticeTransport,
        NoticeTransport.of({
          prepare: (notice) => Effect.succeed(JSON.stringify(notice)),
          send: (wire) =>
            Effect.sync(() => {
              sent.push(wire);
            }),
        })
      );

      const speaks = durableSpeaks.pipe(Layer.provide(notices));
      yield* Effect.gen(function* verify() {
        const store = yield* Store;
        const finishes: string[] = [];

        const tracedStore = Store.of({
          ...store,
          finish: (runId, cursor, books) =>
            Effect.sync(() => {
              finishes.push(runId);
            }).pipe(Effect.andThen(store.finish(runId, cursor, books))),
        });

        if (mode === "off") {
          yield* supervisor(
            { ...canaryConfig(), mode: "off" },
            () => Effect.succeed("invented"),
            transport
          ).pipe(Effect.provideService(Store, tracedStore));
          expect(finishes).toHaveLength(0);
          expect(modelCalls).toHaveLength(0);
          expect(yield* store.cursor()).toBe("");

          return yield* Effect.void;
        }

        if (mode === "canary") {
          yield* store.start("seed");
          yield* store.finish("seed", "9", emptyBooks());
          yield* supervisor(
            canaryConfig(),
            () => Effect.succeed("invented"),
            transport
          ).pipe(Effect.provideService(Store, tracedStore));
          expect(yield* store.cursor()).toBe("9");
          expect(finishes).toHaveLength(1);
          expect(yield* store.search("bounded", "orchid")).toHaveLength(1);
          expect(
            sent.some(
              (wire) =>
                wire.includes("remembers-canary-") && wire.includes("sha256")
            )
          ).toBe(true);

          return yield* Effect.void;
        }

        const base = {
          baseUrl: "https://slice.invalid",
          bearer: "invented",
          idleMs: 1000,
          transport,
        };

        const run = (day: number) => {
          const number = day / dayMillis + 1;
          const options = { ...base, dayEnd: day + dayMillis, dayStart: day };

          const source = Layer.succeed(
            SliceSource,
            SliceSource.of({
              defectCount: defectCountJob(options),
              page: cursorJob(options),
              quote: failure,
              read: failure,
            })
          );

          const plans = planSteps({
            admit: () => Effect.void,
            at: options.dayEnd,
            authorize: () => Effect.succeed("invented"),
            endpoint: "https://worker.invalid",
            prefix: "invented observer",
            rubric: "invented judge",
            transport,
          });

          return runNight({
            at: options.dayEnd,
            owner: "fixture",
            runId: `day-${number}`,
          }).pipe(
            Effect.provideService(Store, tracedStore),
            Effect.provide([source, plans]),
            Effect.mapError(
              () => new Failure({ code: "night", operation: "test" })
            )
          );
        };

        const context = yield* Effect.context<
          SqlCells | Speaks | Store | Recheck
        >();

        const ports = {
          audit: () => Effect.void,
          completed: (day: number) =>
            completedRun(`day-${day / dayMillis + 1}`).pipe(
              Effect.provide(context)
            ),
          load: () => Effect.succeed(0),
          run: (day: number) => run(day).pipe(Effect.provide(context)),
          threshold: 40,
        };

        const exit = yield* Effect.exit(catchUp(0, 2 * dayMillis, ports));
        expect(Exit.isSuccess(exit)).toBe(mode === "success");

        const expected = {
          failed: { count: 1, cursor: "1" },
          raw: { count: 0, cursor: "" },
          success: { count: 3, cursor: "3" },
        }[mode];

        expect(yield* store.cursor()).toBe(expected.cursor);
        const records = yield* store.search("bounded", "orchid");
        expect(records).toHaveLength(expected.count);
        expect(finishes).toHaveLength(expected.count);
        expect(new Set(finishes).size).toBe(expected.count);
        expect(JSON.stringify(sent)).not.toContain(
          "invented forbidden evidence"
        );

        if (mode === "success") {
          const before = modelCalls.length;
          yield* catchUp(0, 2 * dayMillis, ports);
          expect(modelCalls).toHaveLength(before);
          expect(finishes).toHaveLength(3);
          expect(
            sent.every((wire) => !wire.includes("invented observer"))
          ).toBe(true);
          expect(sent.some((wire) => wire.includes("sha256"))).toBe(true);
        }

        return yield* Effect.void;
      }).pipe(Effect.provide(speaks));
    }).pipe(
      Effect.provide([
        Layer.succeed(Recheck, Recheck.of({ arm: () => Effect.void })),
        sqliteStore.pipe(
          Layer.provideMerge(
            nodeCells(":memory:", new Map([["orchid", ":memory:"]]))
          )
        ),
      ]),
      Effect.scoped
    ),
  { arbitrary: { runs: 20 } }
);
