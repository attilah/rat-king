// @effect-diagnostics nodeBuiltinImport:off -- Rebuilds the committed bundle through its shell script.
import { spawnSync } from "node:child_process";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

const here = new URL("..", import.meta.url).pathname;

it.effect(
  "the committed bundle is exactly what bundle.sh builds from source, and it carries no workspace references",
  () =>
    Effect.gen(function* bundleIsFresh() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const fresh = path.join(directory, "bundle");

      const result = spawnSync("sh", [path.join(here, "bundle.sh"), fresh], {
        encoding: "utf-8",
        timeout: 90_000,
      });

      expect(result.status).toBe(0);

      const committed = path.join(here, "bundle");

      const files = (yield* fs.readDirectory(fresh, {
        recursive: true,
      })).toSorted();

      expect(
        (yield* fs.readDirectory(committed, { recursive: true })).toSorted()
      ).toEqual(files);

      for (const file of files) {
        const target = path.join(fresh, file);

        if ((yield* fs.stat(target)).type === "File") {
          const text = yield* fs.readFileString(target);

          expect(yield* fs.readFileString(path.join(committed, file))).toBe(
            text
          );
          expect(text).not.toContain("workspace:");
          expect(text).not.toMatch(/(?:from\s*|import\(\s*)["']@rat-king\//u);
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  120_000
);
