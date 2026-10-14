// @effect-diagnostics asyncFunction:off -- The WebCrypto signing stub is a Promise boundary.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { RatKing } from "@rat-king/ratking-client/ratking";
import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { expect, vi } from "vitest";

import { runAction } from "../../../packages/pi-ratking/src/tool.ts";
import type { ToolParamsValue } from "../../../packages/pi-ratking/src/tool.ts";
import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { runRatking } from "../src/main.ts";
import { Wiring } from "../src/session.ts";
import { captured, fakeMailbox, people, seeded } from "./fixture.ts";
import type { People } from "./fixture.ts";

const Text = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9 ,.]{0,60}$/u));

const LongText = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9 ,.]{200,400}$/u)
);

const Send = Schema.Struct({
  body: Text,
  cc: Schema.Boolean,
  quiet: Schema.Boolean,
  summary: Schema.optionalKey(Schema.Union([Text, LongText])),
});

const deterministic = Effect.acquireRelease(
  Effect.sync(() => {
    const random = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        if (array !== null) {
          new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(
            7
          );
        }

        return array;
      });

    const sign = vi
      .spyOn(crypto.subtle, "sign")
      .mockImplementation(async (_algorithm, _key, data) => {
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", data)
        );

        return new Uint8Array([...digest, ...digest]).buffer;
      });

    return { random, sign };
  }),
  ({ random, sign }) =>
    Effect.sync(() => {
      random.mockRestore();
      sign.mockRestore();
    })
);

const bodies = (fake: ReturnType<typeof fakeMailbox>) =>
  fake.calls.flatMap((call) =>
    call.nsid.endsWith(".send") ? [JSON.stringify(call.body)] : []
  );

type SendCase = typeof Send.Type;

const toolParams = (send: SendCase) => {
  const params: ToolParamsValue = {
    action: "send",
    message: send.body,
    quiet: send.quiet,
    to: "peer",
  };

  if (send.cc) {
    Object.assign(params, { cc: ["other"] });
  }

  if (send.summary !== undefined) {
    Object.assign(params, { summary: send.summary });
  }

  return params;
};

const cliArgs = (send: SendCase) => {
  const args = ["send", "--as", "tester", "--to", "peer", "--body", send.body];

  if (send.cc) {
    args.push("--cc", "other");
  }

  if (send.quiet) {
    args.push("--quiet");
  }

  if (send.summary !== undefined) {
    args.push("--summary", send.summary);
  }

  return args;
};

const facts = {
  alive: () => false,
  env: Option.some("tester"),
  pane: Option.none(),
  pid: 1,
  reads: false,
  session: "wire",
};

const known = (who: People) =>
  Effect.gen(function* recordPeers() {
    const directory = yield* Directory;
    yield* directory.record("peer", who.peerDocument);
    yield* directory.record("other", who.otherDocument);
  });

it.effect.prop(
  "the CLI and the Pi tool put byte-identical signed request bodies on the wire for the same send under a fixed clock, key and TID",
  [Send],
  ([send]) =>
    Effect.gen(function* equivalence() {
      yield* deterministic;
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const secrets = seeded(who);
      const viaTool = fakeMailbox([]);
      const viaCli = fakeMailbox([]);

      yield* Effect.gen(function* tool() {
        yield* known(who);
        yield* (yield* RatKing).run(facts, () => Effect.void);

        const result = yield* runAction(
          "ratking",
          "10 minutes",
          toolParams(send)
        );

        expect(result.isError).toBe(false);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          harness(yield* fs.makeTempDirectoryScoped(), viaTool.http, [], {
            secrets,
          })
        )
      );

      const out = captured();

      const wiring = harness(
        yield* fs.makeTempDirectoryScoped(),
        viaCli.http,
        [],
        { secrets }
      );

      yield* known(who).pipe(Effect.provide(wiring));

      yield* runRatking(cliArgs(send)).pipe(
        Effect.provideService(Console.Console, out.console),
        Effect.provideService(Wiring, wiring)
      );

      expect(out.stderr).toEqual([]);
      expect(viaCli.sends.length).toBe(send.cc ? 2 : 1);

      expect(bodies(viaCli)).toEqual(bodies(viaTool));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 }, timeout: 120_000 }
);
