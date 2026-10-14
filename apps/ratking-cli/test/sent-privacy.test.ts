import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { Console, Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { runRatking } from "../src/main.ts";
import { Wiring } from "../src/session.ts";
import { captured, fakeMailbox, people, seeded } from "./fixture.ts";

const MODE = 0o1000;

it.live.prop(
  "the sent record is 0600 in a 0700 directory after the first send, even when the directory already existed loose",
  [Schema.Boolean, Schema.Boolean],
  ([loose, encrypt]) =>
    Effect.gen(function* private_() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const who = yield* people;
      const dir = `${state}/sent`;

      if (loose) {
        yield* fs.makeDirectory(dir, { mode: 0o755 });
        yield* fs.chmod(dir, 0o755);
        yield* fs.writeFileString(`${dir}/tester.jsonl`, "", { mode: 0o644 });
        yield* fs.chmod(`${dir}/tester.jsonl`, 0o644);
      }

      const wiring = harness(state, fakeMailbox([]).http, [], {
        secrets: seeded(who),
      });

      yield* Directory.use((directory) =>
        directory.record("peer", who.peerDocument)
      ).pipe(Effect.provide(wiring));

      yield* runRatking([
        "send",
        "--as",
        "tester",
        "--to",
        "peer",
        "--summary",
        "s",
        "--body",
        "secret body",
        ...(encrypt ? ["--encrypt"] : []),
      ]).pipe(
        Effect.provideService(Console.Console, captured().console),
        Effect.provideService(Wiring, wiring)
      );

      const file = `${dir}/tester.jsonl`;

      expect((yield* fs.stat(file)).mode % MODE).toBe(0o600);
      expect((yield* fs.stat(dir)).mode % MODE).toBe(0o700);
      expect(yield* fs.readFileString(file)).toContain("secret body");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 6 }, timeout: 60_000 }
);
