import { DateTime, Effect, FileSystem, Option, Path, Stream } from "effect";

import { FleetError } from "./stage-config.ts";

export const rotateAboveBytes = 16 * 1024 * 1024;

export const keepArchiveMs = 30 * 24 * 60 * 60 * 1000;

const stamp = (now: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(now)).replaceAll(/[-:.]/gu, "");

const archiveAge = (stem: string, ext: string, name: string, now: number) => {
  const prefix = `${stem}.`;
  const suffix = `${ext}.gz`;

  if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
    return Option.none<number>();
  }

  const t = name.slice(prefix.length, name.length - suffix.length);

  return /^\d{8}T\d{9}Z$/u.test(t)
    ? Option.map(
        DateTime.make(
          `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}.${t.slice(15, 18)}Z`
        ),
        (at) => now - DateTime.toEpochMillis(at)
      )
    : Option.none<number>();
};

export const rotateLog = Effect.fn("Alarm.rotateLog")(function* rotateLog(
  file: string,
  now: number,
  maxBytes = rotateAboveBytes
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (!(yield* fs.exists(file))) {
    return { archive: undefined, pruned: [] };
  }

  const { dir, ext, name: stem } = path.parse(file);
  const size = Number((yield* fs.stat(file)).size);
  let archive: string | undefined;

  if (size > maxBytes) {
    archive = path.join(dir, `${stem}.${stamp(now)}${ext}.gz`);

    const gzipped = Stream.fromReadableStream({
      evaluate: () =>
        Stream.toReadableStream(
          fs
            .stream(file, { bytesToRead: size, offset: 0 })
            .pipe(Stream.map((chunk) => Uint8Array.from(chunk)))
        ).pipeThrough(new CompressionStream("gzip")),
      onError: () => new FleetError({ reason: "Log compression failed" }),
    });

    yield* Stream.run(gzipped, fs.sink(archive, { flag: "wx", mode: 0o600 }));
    yield* Effect.scoped(
      Effect.flatMap(fs.open(archive, { flag: "r+" }), (handle) => handle.sync)
    );

    const tail = (yield* fs
      .stream(file, { offset: size })
      .pipe(Stream.runCollect)).flatMap((chunk) => [...chunk]);

    yield* fs.truncate(file, 0);

    if (tail.length > 0) {
      yield* fs.writeFile(file, Uint8Array.from(tail), { flag: "a" });
    }
  }

  const pruned: string[] = [];

  for (const name of yield* fs.readDirectory(dir)) {
    const age = archiveAge(stem, ext, name, now);

    if (Option.isSome(age) && age.value > keepArchiveMs) {
      yield* fs.remove(path.join(dir, name));
      pruned.push(name);
    }
  }

  return { archive, pruned };
});

export const rotateLogs = (files: readonly string[], now: number) =>
  Effect.forEach(
    files,
    (file) =>
      rotateLog(file, now).pipe(
        Effect.flatMap((result) =>
          result.archive === undefined
            ? Effect.void
            : Effect.logInfo(
                `Rotated ${file} to ${result.archive}; pruned ${result.pruned.length} old archives`
              )
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning(`Log rotation failed for ${file}`, cause)
        )
      ),
    { discard: true }
  );
