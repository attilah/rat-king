import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

import { frames } from "../scripts/frames.ts";
import { BRAND } from "../src/ui/brand.ts";

const viewFiles = [
  "message-view.ts",
  "notice-view.ts",
  "tool-view.ts",
  "tui.ts",
];

const valid = (text: string) => !text.includes(BRAND);

it.effect.prop(
  "views compose the owned brand; planting a literal header in any view violates the fence",
  [Arbitrary.schema(Schema.Literals(viewFiles))],
  ([file]) =>
    Effect.gen(function* brandFence() {
      const fs = yield* FileSystem.FileSystem;

      const source = yield* fs.readFileString(
        new URL(`../src/${file}`, import.meta.url).pathname
      );

      expect(valid(source)).toBe(true);
      expect(valid(`${source}\nconst header = '${BRAND} from peer';`)).toBe(
        false
      );
    }).pipe(Effect.provide(NodeFileSystem.layer))
);

it.effect(
  "the swipe file is generated from the real primitives and stale frames fail",
  () =>
    Effect.gen(function* frameFence() {
      const fs = yield* FileSystem.FileSystem;

      const saved = yield* fs.readFileString(
        new URL(
          "../skills/ratking-tui/references/primitives.md",
          import.meta.url
        ).pathname
      );

      expect(saved).toBe(frames());
      expect(`${saved}stale`).not.toBe(frames());
    }).pipe(Effect.provide(NodeFileSystem.layer))
);
