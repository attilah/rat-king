import {
  Array as Arr,
  Effect,
  FileSystem,
  Result,
  Schedule,
  Schema,
} from "effect";

import { Turn } from "../../packages/lexicon/turns.ts";
import type { TurnValue } from "../../packages/lexicon/turns.ts";
import { collectReaderHeartbeats } from "./alarm-collector.ts";
import { prepareAlarmMail, sendAlarmDelivery } from "./alarm-mail.ts";
import { Delivery } from "./alarm.ts";
import { FleetError } from "./stage-config.ts";
import type { StageConfigValue } from "./stage-config.ts";

export interface CrashNotice {
  readonly owner: string;
  readonly record: TurnValue;
}

export interface CrashEntry<D> {
  readonly delivery: D;
  readonly key: string;
}

export interface CrashJournalValue<D> {
  readonly pending: readonly CrashEntry<D>[];
  readonly sent: readonly string[];
  readonly version: "0.1";
}

export interface CrashPorts<D, E, R> {
  readonly prepare: (notice: CrashNotice) => Effect.Effect<D, E, R>;
  readonly save: (journal: CrashJournalValue<D>) => Effect.Effect<void, E, R>;
  readonly send: (delivery: D) => Effect.Effect<void, E, R>;
}

const Journal = Schema.fromJsonString(
  Schema.Struct({
    pending: Schema.Array(
      Schema.Struct({ delivery: Delivery, key: Schema.String })
    ),
    sent: Schema.Array(Schema.String),
    version: Schema.Literal("0.1"),
  })
);

type OperatorJournal = CrashJournalValue<typeof Delivery.Type>;

const emptyJournal: OperatorJournal = { pending: [], sent: [], version: "0.1" };

export const freshCrashes = (
  notices: readonly CrashNotice[],
  seen: ReadonlySet<string>
) => {
  const unique = new Map<string, CrashNotice>();

  for (const notice of notices) {
    const key = `${notice.record.agent}:${notice.record.generation}`;

    if (!seen.has(key)) {
      unique.set(key, notice);
    }
  }

  return [...unique];
};

export const crashCycle = Effect.fn("Alarm.crashCycle")(function* crashCycle<
  D,
  E,
  R,
>(
  notices: readonly CrashNotice[],
  prior: CrashJournalValue<D>,
  ports: CrashPorts<D, E, R>
) {
  let next = prior;

  const known = new Set([
    ...prior.sent,
    ...prior.pending.map((entry) => entry.key),
  ]);

  for (const [key, notice] of freshCrashes(notices, known)) {
    const prepared = yield* ports.prepare(notice).pipe(Effect.result);

    if (Result.isSuccess(prepared)) {
      next = {
        pending: Arr.append(next.pending, { delivery: prepared.success, key }),
        sent: next.sent,
        version: next.version,
      };
      yield* ports.save(next);
    } else {
      yield* Effect.logWarning(
        "Crash record preparation failed",
        prepared.failure
      );
    }
  }

  for (const entry of next.pending) {
    const sent = yield* ports.send(entry.delivery).pipe(Effect.result);

    if (Result.isSuccess(sent)) {
      next = {
        pending: next.pending.filter((pending) => pending.key !== entry.key),
        sent: Arr.append(next.sent, entry.key),
        version: next.version,
      };
      yield* ports.save(next);
    } else {
      yield* Effect.logWarning(
        "Crash record send failed; sealed envelope retained",
        sent.failure
      );
    }
  }

  return next;
});

const prepareCrash = Effect.fn("Alarm.prepareCrash")(function* prepareCrash(
  config: StageConfigValue,
  notice: CrashNotice
) {
  const prepared = yield* prepareAlarmMail(config, [notice.owner], "");
  const target = prepared.targets.find((item) => item.name === notice.owner);

  if (target === undefined) {
    return yield* new FleetError({ reason: "Crash record owner unresolved" });
  }

  const body = yield* Schema.encodeEffect(Schema.fromJsonString(Turn))(
    notice.record
  );

  return {
    envelope: yield* prepared.client.seal(target.did, body, { encrypt: false }),
    key: "readers.stuck" as const,
    recipient: notice.owner,
  };
}, Effect.scoped);

export const readerCrashSources = (config: Pick<StageConfigValue, "alarm">) =>
  config.alarm?.turnRecords === true
    ? config.alarm.readerHeartbeats
    : undefined;

export const watchReaderCrashes = Effect.fn("Alarm.watchReaderCrashes")(
  function* watchReaderCrashes(config: StageConfigValue, directory: string) {
    const sources = readerCrashSources(config);

    if (sources === undefined) {
      return yield* Effect.void;
    }

    const fs = yield* FileSystem.FileSystem;
    const file = `${directory}/turn-crashes.json`;

    const read = Effect.gen(function* readJournal() {
      if (!(yield* fs.exists(file))) {
        return emptyJournal;
      }

      if (
        (yield* fs.stat(file)).mode % 0o1000 !== 0o600 ||
        (yield* fs.realPath(file)) !== file
      ) {
        return yield* new FleetError({
          reason: "Crash journal must be a private owned file",
        });
      }

      return yield* Schema.decodeEffect(Journal)(
        yield* fs.readFileString(file)
      );
    });

    const save = Effect.fn("Alarm.saveCrashes")(function* save(
      journal: OperatorJournal
    ) {
      const text = yield* Schema.encodeEffect(Journal)(journal);

      yield* Effect.gen(function* syncJournal() {
        const handle = yield* fs.open(`${file}.tmp`, {
          flag: "w",
          mode: 0o600,
        });

        yield* handle.writeAll(new TextEncoder().encode(text));
        yield* handle.sync;
      }).pipe(Effect.scoped);
      yield* fs.rename(`${file}.tmp`, file);
    });

    const ports: CrashPorts<
      typeof Delivery.Type,
      FleetError,
      Effect.Services<ReturnType<typeof prepareCrash>>
    > = {
      prepare: (notice) =>
        prepareCrash(config, notice).pipe(
          Effect.timeout("2 seconds"),
          Effect.mapError(
            () => new FleetError({ reason: "Crash record preparation failed" })
          )
        ),
      save: (journal) =>
        save(journal).pipe(
          Effect.mapError(
            () => new FleetError({ reason: "Crash journal write failed" })
          )
        ),
      send: (delivery) =>
        sendAlarmDelivery(config, delivery).pipe(
          Effect.timeout("2 seconds"),
          Effect.mapError(
            () => new FleetError({ reason: "Crash record delivery failed" })
          )
        ),
    };

    const pass = Effect.gen(function* pass() {
      const observations = yield* Effect.forEach(
        sources,
        (source) =>
          collectReaderHeartbeats(source).pipe(
            Effect.timeout("2 seconds"),
            Effect.catchCause(() => Effect.succeed({ crashes: [], seen: [] }))
          ),
        { concurrency: "unbounded" }
      );

      yield* crashCycle(
        observations.flatMap((observation) => observation.crashes),
        yield* read,
        ports
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Reader crash notification failed", cause)
      )
    );

    yield* pass.pipe(
      Effect.repeat(Schedule.spaced("2 seconds")),
      Effect.forkScoped
    );

    return yield* Effect.void;
  }
);
