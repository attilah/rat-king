import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  Arbitrary,
  DateTime,
  Effect,
  FileSystem,
  Path,
  Schema,
  Stream,
} from "effect";
import { expect } from "vitest";

import { rotateLog } from "../../../stacks/nest/log-rotation.ts";
import { FleetError } from "../../../stacks/nest/stage-config.ts";

const day = 24 * 60 * 60 * 1000;

const now = Date.parse("2026-10-26T12:00:00.000Z");

const gunzip = (bytes: Uint8Array) =>
  Stream.fromReadableStream({
    evaluate: () =>
      Stream.toReadableStream(Stream.make(Uint8Array.from(bytes))).pipeThrough(
        new DecompressionStream("gzip")
      ),
    onError: () => new FleetError({ reason: "gunzip failed" }),
  }).pipe(
    Stream.runCollect,
    Effect.map((chunks) => chunks.flatMap((chunk) => [...chunk]))
  );

const Byte = Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 }));

it.effect.prop(
  "rotation keeps every byte: the archive gunzips to the old file and the live file is empty",
  [
    Arbitrary.schema(Schema.Array(Byte).check(Schema.isMinLength(1))),
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 60, minimum: 0 }))
    ),
  ],
  ([ints, limit]) =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const live = path.join(dir, "alarm.out.log");
      const bytes = Uint8Array.from(ints);
      yield* fs.writeFile(live, bytes);

      const result = yield* rotateLog(live, now, limit);

      expect(result.archive !== undefined).toBe(bytes.length > limit);

      if (result.archive === undefined) {
        expect([...(yield* fs.readFile(live))]).toEqual([...bytes]);
      } else {
        expect(result.archive).toMatch(/alarm\.out\.\d{8}T\d{9}Z\.log\.gz$/u);
        expect(yield* gunzip(yield* fs.readFile(result.archive))).toEqual([
          ...bytes,
        ]);
        expect(Number((yield* fs.stat(live)).size)).toBe(0);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "archives older than thirty days are pruned and nothing else is touched",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 90, minimum: 0 }))
    ),
  ],
  ([ageDays]) =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const live = path.join(dir, "alarm.out.log");
      yield* fs.writeFileString(live, "x");

      const old = `alarm.out.${DateTime.formatIso(DateTime.makeUnsafe(now - ageDays * day)).replaceAll(/[-:.]/gu, "")}.log.gz`;
      const other = "alarm.err.20200101T000000000Z.log.gz";
      yield* fs.writeFileString(path.join(dir, old), "gz");
      yield* fs.writeFileString(path.join(dir, other), "other");

      yield* rotateLog(live, now);
      const files = yield* fs.readDirectory(dir);

      expect(files.includes(old)).toBe(ageDays <= 30);
      expect(files).toContain(other);
      expect(files).toContain("alarm.out.log");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
