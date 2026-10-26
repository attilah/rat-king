import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Settings } from "@rat-king/ratking-client/config";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { expect } from "vitest";

import { sentBy, SENT_RESULT_LIMIT } from "../src/sent.ts";

it.effect.prop(
  "sent results cap history across retained archives",
  [Schema.Int.check(Schema.isBetween({ maximum: 10, minimum: 1 }))],
  ([extra]) =>
    Effect.gen(function* proof() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const state = yield* fs.makeTempDirectoryScoped();
      const dir = path.join(state, "sent");
      yield* fs.makeDirectory(dir);

      const records = Array.from(
        { length: SENT_RESULT_LIMIT + extra },
        (_, index) =>
          JSON.stringify({
            body: "",
            from: "tester",
            id: String(index),
            seq: index,
            summary: "synthetic",
            thread: "synthetic",
            to: "peer",
          })
      );

      yield* fs.writeFileString(
        path.join(dir, "tester.jsonl.1"),
        `${records.slice(0, 1000).join("\n")}\n`
      );
      yield* fs.writeFileString(
        path.join(dir, "tester.jsonl"),
        `${records.slice(1000).join("\n")}\n`
      );

      const result = yield* sentBy("tester").pipe(
        Effect.provide(
          Layer.succeed(
            Settings,
            Settings.of({
              askTimeoutMs: 1000,
              didTemplate: "did:web:{agent}.invalid",
              directory: path.join(state, "directory.json"),
              documents: [],
              encrypt: false,
              endpoint: "https://mailbox.invalid",
              issuer: Option.none(),
              refuse: [],
              relays: [],
              reserved: {},
              secretsCommand: "unused",
              serviceDid: "did:web:mailbox.invalid",
              state,
            })
          )
        )
      );

      expect(result).toHaveLength(SENT_RESULT_LIMIT);
      expect(result[0]?.id).toBe(String(extra));
      expect(result.at(-1)?.id).toBe(String(SENT_RESULT_LIMIT + extra - 1));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 4 } }
);
