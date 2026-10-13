import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Turn } from "@rat-king/lexicon/turns";
import { Effect, FileSystem, Layer, Option, Schema } from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import { RatKing, ReaderState } from "../src/ratking.ts";
import { turnReporter } from "../src/turn-record.ts";
import { harness } from "./harness.ts";

type Step = "done" | "live" | "working";

interface Startup {
  readonly name: string;
  readonly steps: readonly Step[];
  readonly expected: readonly string[];
}

const startups: readonly Startup[] = [
  {
    expected: ["idle:3", "working:4", "done:4"],
    name: "live before the first turn announces idle",
    steps: ["live", "working", "done"],
  },
  {
    expected: ["working:4", "done:4"],
    name: "a turn started before live is announced as working",
    steps: ["working", "live", "done"],
  },
  {
    expected: ["done:4"],
    name: "a turn finished before live is announced as done when live",
    steps: ["working", "done", "live"],
  },
];

const replay = (startup: Startup) =>
  Effect.gen(function* replayStartup() {
    const fs = yield* FileSystem.FileSystem;
    const state = yield* fs.makeTempDirectoryScoped();
    const sent: string[] = [];
    let ready = false;

    const layer = Layer.mergeAll(
      harness(
        state,
        HttpClient.make(() => Effect.die("Unexpected HTTP")),
        [],
        { turnRecords: true }
      ),
      Layer.mock(RatKing, {
        send: (_owner, body) =>
          Effect.gen(function* send() {
            const record = yield* Schema.decodeUnknownEffect(Turn)(body).pipe(
              Effect.orDie
            );

            sent.push(`${record.state}:${record.turnId.split(":").at(-1)}`);

            return {
              did: "did:web:owner.invalid",
              id: "id",
              seq: 1,
              to: "owner",
            };
          }),
        status: Effect.sync(() => ({
          endpoint: "https://mailbox.invalid",
          openAsks: 0,
          quarantine: { count: 0, latest: Option.none() },
          reader: ReaderState.Starting({ reason: "test" }),
          self: ready
            ? Option.some({ did: "did:web:worker.invalid", name: "worker" })
            : Option.none(),
        })),
      })
    );

    const turns = turnReporter(
      {
        alive: () => true,
        env: Option.some("worker"),
        owner: Option.some("owner"),
        pane: Option.none(),
        pid: 1,
        session: "session",
      },
      3
    );

    for (const step of startup.steps) {
      if (step === "live") {
        ready = true;
        yield* turns.idle().pipe(Effect.provide(layer));
      } else if (step === "working") {
        yield* turns.working().pipe(Effect.provide(layer));
      } else {
        yield* turns.done("stop").pipe(Effect.provide(layer));
      }
    }

    return sent;
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

for (const startup of startups) {
  it.effect(startup.name, () =>
    Effect.gen(function* startupProof() {
      expect(yield* replay(startup)).toStrictEqual(startup.expected);
    })
  );
}
