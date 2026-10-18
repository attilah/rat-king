import { Effect, FileSystem, Layer, Option, Path } from "effect";

import { absent } from "./absent.ts";
import { HostError, HostShell } from "./host-shell.ts";
import type { Entry, Interface } from "./host-shell.ts";
import { localExec } from "./local-exec.ts";

const failed = (operation: string) =>
  new HostError({
    operation,
    reason: "Local Darwin filesystem operation refused or failed.",
  });

export const darwinLocalShell = Layer.effect(
  HostShell,
  Effect.gen(function* local() {
    const uid = process.getuid?.();

    if (process.platform !== "darwin" || uid === undefined || uid === 0) {
      return yield* failed("platform");
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const command = yield* localExec;

    const metadata = Effect.fn("Darwin.metadata")(function* metadata(
      target: string
    ) {
      if (!(yield* fs.exists(target))) {
        if (
          (yield* fs.exists(path.dirname(target))) &&
          (yield* fs.readDirectory(path.dirname(target))).includes(
            path.basename(target)
          )
        ) {
          return yield* failed("symlink");
        }

        return absent;
      }

      const entry = yield* fs.stat(target);

      if (
        (yield* fs.realPath(target)) !== target ||
        (entry.type !== "File" && entry.type !== "Directory") ||
        Option.getOrUndefined(entry.uid) !== uid
      ) {
        return yield* failed("ownership");
      }

      return entry;
    });

    const ownedDirectory = Effect.fn("Darwin.directory")(function* directory(
      target: string
    ) {
      const entry = yield* metadata(target);

      if (
        entry?.type !== "Directory" ||
        /[2367]/u.test((entry.mode % 0o100).toString(8).padStart(2, "0"))
      ) {
        return yield* failed("directory");
      }

      return yield* Effect.void;
    });

    const mapped = Effect.mapError(() => failed("filesystem"));

    return HostShell.of({
      exec: command.exec,
      mkdir: Effect.fn("Darwin.mkdir")(function* mkdir(input) {
        const prior = yield* metadata(input.path);

        if (prior === undefined) {
          yield* ownedDirectory(path.dirname(input.path));
          yield* fs.makeDirectory(input.path, { mode: input.mode });
        } else if (
          prior.type !== "Directory" ||
          prior.mode % 0o1000 !== input.mode
        ) {
          return yield* failed("mkdir");
        }

        return yield* Effect.void;
      }, mapped),
      purgeRoots: [],
      read: Effect.fn("Darwin.read")(function* read(target) {
        return (yield* metadata(target)) === undefined
          ? undefined
          : yield* fs.readFile(target);
      }, mapped),
      remove: Effect.fn("Darwin.remove")(function* remove(target) {
        yield* ownedDirectory(path.dirname(target));
        yield* metadata(target);
        yield* fs.remove(target);
      }, mapped),
      rmdir: Effect.fn("Darwin.rmdir")(function* rmdir(target) {
        yield* ownedDirectory(target);
        yield* fs.remove(target);
      }, mapped),
      stat: Effect.fn("Darwin.stat")(function* stat(target) {
        const entry = yield* metadata(target);

        return entry === undefined
          ? undefined
          : ({
              kind: entry.type === "File" ? "file" : "directory",
              mode: entry.mode % 0o1000,
            } satisfies Entry);
      }, mapped),
      write: Effect.fn("Darwin.atomicWrite")(
        function* write(input) {
          yield* ownedDirectory(path.dirname(input.path));
          yield* metadata(input.path);

          const temporary = yield* fs.makeTempFileScoped({
            directory: path.dirname(input.path),
            prefix: ".launchd-",
          });

          yield* fs.writeFile(temporary, input.bytes);
          yield* fs.chmod(temporary, input.mode);
          yield* Effect.scoped(
            Effect.gen(function* sync() {
              const handle = yield* fs.open(temporary, { flag: "r+" });
              yield* handle.sync;
            })
          );
          yield* metadata(input.path);
          yield* fs.rename(temporary, input.path);
        },
        Effect.scoped,
        mapped
      ),
    } satisfies Interface);
  })
);
