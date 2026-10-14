import { Settings } from "@rat-king/ratking-client/config";
import { provisionLabel } from "@rat-king/ratking-client/name";
import { Effect, FileSystem, Option, Path, Schema } from "effect";

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

  yield* fs.writeFileString(
    file,
    `${yield* Schema.encodeEffect(Schema.fromJsonString(SentRecord))(record)}\n`,
    { flag: "a", mode: 0o600 }
  );
  yield* fs.chmod(file, 0o600);
});

export const recordSent = (record: SentRecordValue) =>
  append(record).pipe(Effect.ignore);

const readSent = Effect.fn("RatkingCli.sentBy")(function* readSent(
  name: string
) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(yield* fileFor(name));

  return text
    .split("\n")
    .flatMap((line) =>
      Option.match(
        Schema.decodeUnknownOption(Schema.fromJsonString(SentRecord))(line),
        { onNone: () => [], onSome: (record) => [record] }
      )
    );
});

export const sentBy = (name: string) =>
  readSent(name).pipe(
    Effect.orElseSucceed((): readonly SentRecordValue[] => [])
  );
