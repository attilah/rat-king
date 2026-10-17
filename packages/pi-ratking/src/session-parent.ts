import { Effect, FileSystem, Option, Schema } from "effect";

const Header = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  type: Schema.Literal("session"),
});

export const parentSessionId = (file: string | undefined) =>
  file === undefined
    ? Effect.succeed(Option.none<string>())
    : Effect.gen(function* readHeader() {
        const fs = yield* FileSystem.FileSystem;
        const handle = yield* fs.open(file, { flag: "r" });
        const bytes = yield* handle.readAlloc(16_384);

        const text = Option.match(bytes, {
          onNone: () => "",
          onSome: (value) => new TextDecoder().decode(value),
        });

        return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Header))(
          text.split("\n")[0] ?? ""
        );
      }).pipe(
        Effect.scoped,
        Effect.map((header) => Option.some(header.id))
      );

export const forkLabel = (
  configured: Option.Option<string>,
  name: string | undefined,
  session: string
) => Option.getOrElse(configured, () => name ?? `fork-${session.slice(0, 6)}`);
