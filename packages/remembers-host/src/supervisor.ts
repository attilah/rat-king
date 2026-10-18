import { loadavg } from "node:os";

import { Failure, Recheck, SliceSource } from "@rat-king/remembers";
import type { Job, Speaks, Store } from "@rat-king/remembers";
import { auditOwed, runNight } from "@rat-king/remembers/night";
import { SqlCells, sqliteStore } from "@rat-king/remembers/sqlite";
import { Clock, DateTime, Effect, Layer, Option, Redacted, Ref } from "effect";

import { completedRun, hostCells } from "./cells.ts";
import type { HostConfig } from "./config.ts";
import { durableSpeaks } from "./notices.ts";
import type { NoticeTransport } from "./notices.ts";
import { planSteps } from "./plan-steps.ts";
import { awaitAdmission, catchUp, dayMillis, nightly } from "./scheduler.ts";
import { cursorJob, defectCountJob } from "./source-jobs.ts";

const unavailable = () =>
  Effect.fail(new Failure({ code: "ephemeral_only", operation: "supervisor" }));

const rechecks = Layer.effect(
  Recheck,
  Effect.gen(function* rechecks() {
    const sql = yield* (yield* SqlCells).control();
    yield* sql.execute(
      "CREATE TABLE IF NOT EXISTS remembers_rechecks(id TEXT PRIMARY KEY,json TEXT NOT NULL)",
      []
    );

    return Recheck.of({
      arm: (record, identity) =>
        sql.execute(
          "INSERT OR IGNORE INTO remembers_rechecks(id,json) VALUES (?,?)",
          [
            JSON.stringify(identity),
            JSON.stringify({
              id: record.id,
              project: record.claim.project,
              recheck: record.claim.recheck,
              subject: record.subject,
            }),
          ]
        ),
    });
  })
);

export const hostRuntime = (
  config: Pick<HostConfig, "root" | "projects">,
  transport: Layer.Layer<NoticeTransport>
) => {
  const cells = hostCells(config.root, config.projects);
  const store = sqliteStore.pipe(Layer.provideMerge(cells));

  const speaks = durableSpeaks.pipe(
    Layer.provide(transport),
    Layer.provideMerge(store)
  );

  return rechecks.pipe(Layer.provideMerge(speaks));
};

const runIdForDay = (day: number, epoch: number) =>
  `remembers-day-${day / dayMillis}-${epoch}`;

const parseDay = (input: Option.Option<string>) => {
  const text = Option.getOrElse(input, () => "");
  const day = Date.parse(`${text}T00:00:00Z`);

  return /^\d{4}-\d{2}-\d{2}$/u.test(text) &&
    Number.isFinite(day) &&
    DateTime.formatIsoDateUtc(DateTime.makeUnsafe(day)) === text
    ? Effect.succeed(day)
    : Effect.fail(new Failure({ code: "day", operation: "config" }));
};

export const supervisor = Effect.fn("RemembersHost.supervisor")(
  function* supervisor(
    config: HostConfig,
    authorize: (capability: string) => Job<string>,
    transport: typeof fetch = fetch
  ) {
    const context = yield* Effect.context<
      Recheck | Speaks | Store | SqlCells
    >();

    const previous = yield* Ref.make("ready");

    const admission = {
      load: () => Effect.sync(() => loadavg()[0] ?? Number.POSITIVE_INFINITY),
      observe: Effect.fn("RemembersHost.observeAdmission")(
        function* observeAdmission(state: string) {
          const before = yield* Ref.getAndSet(previous, state);

          if (before !== state) {
            yield* Effect.logInfo(
              state === "ready"
                ? "Remembers work resumed"
                : "Remembers work paused",
              { reason: state }
            );
          }
        }
      ),
      threshold: config.threshold,
    };

    const run = Effect.fn("RemembersHost.runDay")(function* run(
      day: number,
      canary: boolean,
      floor: number
    ) {
      const at = yield* Clock.currentTimeMillis;
      const dayEnd = canary ? at : day + dayMillis;

      const options = {
        baseUrl: config.sliceUrl,
        bearer: Redacted.value(config.sliceBearer),
        dayEnd,
        dayStart: floor,
        idleMs: config.idleMs,
        transport,
      };

      const canaryKey = config.canary;

      const source = Layer.succeed(
        SliceSource,
        SliceSource.of({
          defectCount: defectCountJob(options),
          page:
            canary && canaryKey !== null
              ? (cursor) => Effect.succeed({ cursor, keys: [canaryKey] })
              : cursorJob(options),
          quote: unavailable,
          read: unavailable,
        })
      );

      const plans = planSteps({
        admit: () => awaitAdmission(admission),
        at,
        authorize,
        endpoint: config.workerUrl,
        prefix: config.prefix,
        rubric: config.rubric,
        transport,
      });

      return yield* runNight({
        at,
        concurrency: 16,
        epoch: config.epoch,
        owner: config.owner,
        runId: canary
          ? `remembers-canary-${day / dayMillis}-${config.epoch}`
          : runIdForDay(day, config.epoch),
      }).pipe(
        Effect.provide([source, plans]),
        Effect.mapError(
          () => new Failure({ code: "night_failed", operation: "supervisor" })
        )
      );
    });

    let floor = 0;

    const ports = {
      ...admission,
      audit: () => auditOwed(config.owner).pipe(Effect.provide(context)),
      completed: (day: number) =>
        completedRun(`remembers-day-${day / dayMillis}-*`).pipe(
          Effect.provide(context)
        ),
      run: (day: number) =>
        run(day, false, floor).pipe(Effect.provide(context)),
    };

    if (config.mode === "off") {
      return yield* ports.audit();
    }

    if (config.mode === "canary") {
      yield* ports.audit();

      if (config.canary === null) {
        return yield* new Failure({ code: "canary_key", operation: "config" });
      }

      yield* awaitAdmission(admission);

      return yield* run(
        Math.floor((yield* Clock.currentTimeMillis) / dayMillis) * dayMillis,
        true,
        0
      ).pipe(Effect.asVoid);
    }

    if (config.mode === "catch-up") {
      const from = yield* parseDay(config.from);
      const through = yield* parseDay(config.through);
      floor = from;

      const today =
        Math.floor((yield* Clock.currentTimeMillis) / dayMillis) * dayMillis;

      if (through >= today) {
        return yield* new Failure({
          code: "unfinished_day",
          operation: "catchUp",
        });
      }

      return yield* catchUp(from, through, ports).pipe(Effect.asVoid);
    }

    return yield* nightly(ports);
  }
);
