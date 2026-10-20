// @effect-diagnostics nodeBuiltinImport:off -- lstat has no Effect FileSystem equivalent; stat follows symlinks.
import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";

import { makeMemoryRunBinding } from "@rat-king/lexicon/passes";
import { TrustFailure } from "@rat-king/lexicon/trust";
import { Effect, FileSystem, Option, Path, Schema, Semaphore } from "effect";

import { withLock } from "./lock.ts";

export const passFailure = (
  why: string,
  what = "Run refused",
  next = "ask the launcher for a new run"
) => new TrustFailure({ reason: `${what}; ${why}; ${next}` });

export const passIo = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    catch: () => passFailure("private pass storage or socket operation failed"),
    try: operation,
  });

const statFile: (
  file: string,
  options: { readonly bigint: false }
) => Promise<Stats> = lstat;

class PrivatePathFailure extends Schema.TaggedError<PrivatePathFailure>()(
  "PrivatePathFailure",
  { missing: Schema.Boolean }
) {}

export const privateStat = (file: string) =>
  Effect.tryPromise({
    catch: (failure) =>
      new PrivatePathFailure({
        missing:
          failure instanceof Error &&
          "code" in failure &&
          failure.code === "ENOENT",
      }),
    try: statFile.bind(undefined, file, { bigint: false }),
  }).pipe(
    Effect.map(Option.some),
    Effect.matchEffect({
      onFailure: (failure) =>
        failure.missing
          ? Effect.succeed(Option.none())
          : Effect.fail(passFailure("private path could not be inspected")),
      onSuccess: Effect.succeed,
    })
  );

const Row = Schema.Struct({
  grantExp: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0)
  ),
  scope: Schema.Array(Schema.Literal("rk.send.plain")),
  state: Schema.Literals(["open", "bound", "closed", "compromised"]),
  tokenExp: Schema.Finite,
  tokenHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  tokenIat: Schema.Finite,
  workerDid: Schema.optionalKey(Schema.String),
});

const Rows = Schema.Record(Schema.String, Row);

export type RunRow = typeof Row.Type;

export const privateDirectory = (directory: string) =>
  Effect.gen(function* checkDirectory() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { mode: 0o700, recursive: true });
    const info = yield* privateStat(directory);

    if (
      Option.isNone(info) ||
      !info.value.isDirectory() ||
      info.value.uid !== process.getuid?.() ||
      info.value.mode % 0o1000 !== 0o700
    ) {
      return yield* passFailure("pass directory owner, type or mode is unsafe");
    }

    return yield* Effect.void;
  }).pipe(
    Effect.mapError(() =>
      passFailure("pass directory owner, type or mode is unsafe")
    )
  );

export const makeRunRegistry = (directory: string, label: string) =>
  Effect.gen(function* makeRegistry() {
    yield* privateDirectory(directory);
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const semaphore = yield* Semaphore.make(1);
    const basename = `${label.replaceAll("/", "%2F")}.runs.json`;
    const file = path.join(directory, basename);

    const transaction = <A>(
      now: number,
      change: (rows: Record<string, RunRow>) => Effect.Effect<A, TrustFailure>
    ) =>
      semaphore.withPermit(
        withLock(
          directory,
          basename,
          Effect.gen(function* updateRegistry() {
            const info = yield* privateStat(file);

            if (
              Option.isSome(info) &&
              (!info.value.isFile() ||
                info.value.uid !== process.getuid?.() ||
                info.value.mode % 0o1000 !== 0o600)
            ) {
              return yield* passFailure(
                "run registry owner, type or mode is unsafe"
              );
            }

            const text = Option.isNone(info)
              ? "{}"
              : yield* fs.readFileString(file);

            const rows = yield* Schema.decodeEffect(
              Schema.fromJsonString(Rows)
            )(text).pipe(
              Effect.mapError(() => passFailure("run registry is malformed"))
            );

            const kept: Record<string, RunRow> = Object.fromEntries(
              Object.entries(rows).filter(
                ([, row]) => now <= row.grantExp + 86_400
              )
            );

            const result = yield* change(kept);
            yield* Effect.scoped(
              Effect.gen(function* writeRegistry() {
                const staging = yield* fs.makeTempDirectoryScoped({
                  directory,
                  prefix: ".run-",
                });

                const temporary = path.join(staging, "registry.json");
                yield* Effect.scoped(
                  Effect.gen(function* writeFile() {
                    const handle = yield* fs.open(temporary, {
                      flag: "wx",
                      mode: 0o600,
                    });

                    yield* handle.writeAll(
                      new TextEncoder().encode(JSON.stringify(kept))
                    );
                    yield* handle.sync;
                  })
                );
                yield* fs.rename(temporary, file);
              })
            );
            yield* Effect.scoped(
              Effect.gen(function* syncDirectory() {
                const handle = yield* fs.open(directory, { flag: "r" });
                yield* handle.sync;
              })
            );

            return result;
          }).pipe(Effect.uninterruptible)
        ).pipe(
          Effect.provideContext(context),
          Effect.mapError((failure) =>
            Schema.is(TrustFailure)(failure)
              ? failure
              : passFailure("run registry operation failed")
          )
        )
      );

    return {
      close: (run: string, now: number) =>
        transaction(now, (rows) =>
          Effect.sync(() => {
            const row = rows[run];

            rows[run] =
              row === undefined
                ? {
                    grantExp: now,
                    scope: [],
                    state: "closed",
                    tokenExp: now,
                    tokenHash: "0".repeat(64),
                    tokenIat: now,
                  }
                : { ...row, state: "closed" };
          })
        ),
      open: (run: string, row: RunRow, now: number) =>
        transaction(now, (rows) =>
          Effect.gen(function* openRun() {
            if (Object.hasOwn(rows, run)) {
              return yield* passFailure("run already exists");
            }

            rows[run] = row;

            return yield* Effect.void;
          })
        ),
      use: (
        run: string,
        workerDid: string,
        tokenHash: string | undefined,
        now: number
      ) =>
        transaction(now, (rows) =>
          Effect.gen(function* useRun() {
            const row = Object.hasOwn(rows, run) ? rows[run] : undefined;

            if (
              row === undefined ||
              row.state === "closed" ||
              row.state === "compromised"
            ) {
              return yield* passFailure(
                "run is unknown, closed or compromised"
              );
            }

            if (now >= row.grantExp) {
              return yield* passFailure(
                "the run's grant has expired",
                "Renewal refused"
              );
            }

            const binding = yield* makeMemoryRunBinding();
            yield* binding.open(
              run,
              {
                exp: row.tokenExp,
                iat: row.tokenIat,
                tokenHash: row.tokenHash,
              },
              row.tokenIat
            );

            if (row.state === "bound") {
              if (row.workerDid === undefined) {
                return yield* passFailure("bound run has no worker key");
              }

              yield* binding.claim(
                run,
                row.tokenHash,
                row.workerDid,
                row.tokenIat
              );
            }

            const result =
              tokenHash === undefined
                ? yield* binding.renew(run, workerDid, now)
                : yield* binding.claim(run, tokenHash, workerDid, now);

            if (result === "compromised") {
              const compromised = { ...row, state: "compromised" as const };
              rows[run] = compromised;

              return compromised;
            }

            const bound = { ...row, state: "bound" as const, workerDid };
            rows[run] = bound;

            return bound;
          })
        ),
    };
  });

export type RunRegistry = Effect.Success<ReturnType<typeof makeRunRegistry>>;
