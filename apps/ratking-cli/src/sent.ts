import { Settings } from "@rat-king/ratking-client/config";
import { withLock } from "@rat-king/ratking-client/lock";
import { appendLog, LOG_ARCHIVES } from "@rat-king/ratking-client/log";
import { provisionLabel } from "@rat-king/ratking-client/name";
import { Effect, FileSystem, Option, Path, Predicate, Schema } from "effect";

export const SentRecord = Schema.Struct({
  body: Schema.String,
  from: Schema.String,
  id: Schema.String,
  replyTo: Schema.optionalKey(Schema.String),
  seq: Schema.Int,
  summary: Schema.String,
  thread: Schema.String,
  to: Schema.String,
});

export type SentRecordValue = typeof SentRecord.Type;

export const SENT_RESULT_LIMIT = 2000;

const fileFor = Effect.fn("RatkingCli.sentFile")(function* fileFor(
  name: string
) {
  const settings = yield* Settings;
  const path = yield* Path.Path;

  return path.join(settings.state, "sent", `${provisionLabel(name)}.jsonl`);
});

const append = Effect.fn("RatkingCli.recordSent")(function* append(
  record: SentRecordValue
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = yield* fileFor(record.from);

  yield* fs.makeDirectory(path.dirname(file), {
    mode: 0o700,
    recursive: true,
  });
  yield* fs.chmod(path.dirname(file), 0o700);

  yield* appendLog(file, [
    yield* Schema.encodeEffect(Schema.fromJsonString(SentRecord))(record),
  ]);
});

export const recordSent = (record: SentRecordValue) =>
  append(record).pipe(Effect.ignore);

const readSent = Effect.fn("RatkingCli.sentBy")(function* readSent(
  name: string
) {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* fileFor(name);
  const path = yield* Path.Path;

  return yield* withLock(
    path.join(path.dirname(file), "locks"),
    "client-log",
    Effect.gen(function* read() {
      const text = (yield* Effect.forEach(
        Array.from({ length: LOG_ARCHIVES + 1 }, (_, index) => {
          const archive = LOG_ARCHIVES - index;

          return archive === 0 ? file : `${file}.${archive}`;
        }),
        (entry) =>
          fs
            .readFileString(entry)
            .pipe(
              Effect.catchTag("PlatformError", (error) =>
                Predicate.isTagged(error.reason, "NotFound")
                  ? Effect.succeed("")
                  : Effect.fail(error)
              )
            )
      )).join("\n");

      return text
        .split("\n")
        .flatMap((line) =>
          Option.match(
            Schema.decodeUnknownOption(Schema.fromJsonString(SentRecord))(line),
            { onNone: () => [], onSome: (record) => [record] }
          )
        )
        .slice(-SENT_RESULT_LIMIT);
    })
  );
});

export const sentBy = (name: string) =>
  readSent(name).pipe(
    Effect.orElseSucceed((): readonly SentRecordValue[] => [])
  );
