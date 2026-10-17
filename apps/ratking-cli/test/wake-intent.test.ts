import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { Console, Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { runRatking } from "../src/main.ts";
import { Wiring } from "../src/session.ts";
import { captured, fakeMailbox, people, seeded, PEER } from "./fixture.ts";

it.effect(
  "health without operator authority reports unknown and performs no mailbox writes",
  () =>
    Effect.gen(function* unknownHealth() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const mailbox = fakeMailbox([]);
      const out = captured();

      const wiring = harness(
        yield* fs.makeTempDirectoryScoped(),
        mailbox.http,
        [],
        { secrets: seeded(who) }
      );

      yield* runRatking(["health", "tester", "--as", "tester"]).pipe(
        Effect.provideService(Console.Console, out.console),
        Effect.provideService(Wiring, wiring)
      );

      expect(out.stdout.join("\n")).toContain("verdict: unknown");
      expect(mailbox.sends).toHaveLength(0);
      expect(
        mailbox.calls.every(
          (call) => call.nsid === "sh.mschf.ratking.mailbox.nameHealth"
        )
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

const Routed = Schema.Struct({
  envelope: Schema.Struct({
    aad: Schema.Struct({ recipientDid: Schema.String }),
    suite: Schema.Struct({ kemId: Schema.Int }),
  }),
  wakeReason: Schema.Literals(["to", "cc", "quiet"]),
  woke: Schema.Boolean,
});

it.effect.prop(
  "encrypted to, cc and quiet declarations travel on the send request without decrypting envelopes",
  [Schema.Boolean],
  ([quiet]) =>
    Effect.gen(function* wireIntent() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const mailbox = fakeMailbox([]);
      const out = captured();

      const wiring = harness(
        yield* fs.makeTempDirectoryScoped(),
        mailbox.http,
        [],
        { secrets: seeded(who) }
      );

      yield* Directory.use((directory) =>
        Effect.all([
          directory.record("peer", who.peerDocument),
          directory.record("other", who.otherDocument),
        ])
      ).pipe(Effect.provide(wiring));
      yield* runRatking([
        "send",
        "--as",
        "tester",
        "--to",
        "peer",
        "--cc",
        "other",
        "--encrypt",
        "--body",
        "fixture",
        ...(quiet ? ["--quiet"] : []),
      ]).pipe(
        Effect.provideService(Console.Console, out.console),
        Effect.provideService(Wiring, wiring)
      );

      const sends = mailbox.calls.filter((call) => call.nsid.endsWith(".send"));

      expect(sends).toHaveLength(2);

      for (const call of sends) {
        const routed = yield* Schema.decodeUnknownEffect(Routed)(call.body);
        const primary = routed.envelope.aad.recipientDid === PEER;

        expect(routed.woke).toBe(primary && !quiet);
        const routedReason = primary ? "to" : "cc";

        expect(routed.wakeReason).toBe(quiet ? "quiet" : routedReason);
        expect(routed.envelope.suite.kemId).toBe(16);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
