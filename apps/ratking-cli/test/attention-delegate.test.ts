import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Status from "@rat-king/lexicon/attention.status";
import * as Send from "@rat-king/lexicon/mailbox.send";
import { Directory } from "@rat-king/ratking-client/directory";
import { Inbox, RatKing } from "@rat-king/ratking-client/ratking";
import { Arbitrary, Console, Effect, FileSystem, Option, Schema } from "effect";
import { expect } from "vitest";

import {
  runAction,
  ToolParams,
} from "../../../packages/pi-ratking/src/tool.ts";
import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { runRatking } from "../src/main.ts";
import { Wiring } from "../src/session.ts";
import {
  captured,
  fakeMailbox,
  people,
  quietAttention,
  seeded,
} from "./fixture.ts";

it.live.prop(
  "CLI busy and dnd flags and the tool write the same status, available clears delegation",
  [
    Arbitrary.schema(Schema.Literals(["busy", "dnd"])),
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 24, minimum: 1 }))
    ),
  ],
  ([state, hours]) =>
    Effect.gen(function* parity() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const attention = quietAttention();
      const mailbox = fakeMailbox([], undefined, attention);

      const wiring = harness(
        yield* fs.makeTempDirectoryScoped(),
        mailbox.http,
        [],
        {
          attentionLevers: true,
          secrets: seeded(who),
        }
      );

      const output = captured();

      yield* runRatking([
        "attention",
        state,
        `${hours}h`,
        "--delegate",
        "alpha/ea",
        "--exempt",
        "alpha/alarm,alpha/backup",
        "--as",
        "tester",
        "--json",
      ]).pipe(
        Effect.provideService(Console.Console, output.console),
        Effect.provideService(Wiring, wiring)
      );

      const cliStatus = yield* Schema.decodeUnknownEffect(Status.Main)(
        attention.status
      );

      expect(cliStatus.delegate).toBe("alpha/ea");
      expect(cliStatus.exempt).toEqual(["alpha/alarm", "alpha/backup"]);

      yield* Effect.gen(function* tool() {
        const ratking = yield* RatKing;
        yield* ratking.run(
          {
            alive: () => false,
            env: Option.some("tester"),
            pane: Option.none(),
            pid: 1,
            reads: false,
            session: "delegate-test",
          },
          () => Effect.void
        );

        const input = yield* Schema.decodeUnknownEffect(ToolParams)({
          action: "attention",
          delegate: "alpha/ea",
          exempt: ["alpha/alarm", "alpha/backup"],
          status: state,
          until: cliStatus.until,
        });

        const result = yield* runAction("ratking", 600, input);
        expect(result.isError).toBe(false);
        expect(attention.status).toEqual(cliStatus);
        yield* runAction("ratking", 600, {
          action: "attention",
          status: "available",
        });
        expect(attention.status).not.toHaveProperty("delegate");
        expect(attention.status).not.toHaveProperty("exempt");
      }).pipe(Effect.provide(wiring));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 6 }, timeout: 30_000 }
);

it.live.prop(
  "send and ask tool actions preserve the sender critical flag in admission input",
  [
    Arbitrary.schema(Schema.Boolean),
    Arbitrary.schema(Schema.Literals(["send", "ask"])),
  ],
  ([critical, action]) =>
    Effect.gen(function* criticalInput() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const mailbox = fakeMailbox([]);

      const wiring = harness(
        yield* fs.makeTempDirectoryScoped(),
        mailbox.http,
        [],
        { secrets: seeded(who) }
      );

      yield* Effect.gen(function* tool() {
        const directory = yield* Directory;
        yield* directory.record("peer", who.peerDocument);
        const inbox = yield* Inbox;
        yield* inbox.attach("tester");

        const result = yield* runAction("ratking", 600, {
          action,
          critical,
          message: "Invented test message",
          to: "peer",
        });

        expect(result.isError, result.text).toBe(false);

        const send = mailbox.calls.find((call) =>
          call.nsid.endsWith("mailbox.send")
        );

        expect(send).toBeDefined();
        const input = yield* Schema.decodeUnknownEffect(Send.Input)(send?.body);
        expect(input.critical).toBe(critical);
      }).pipe(Effect.provide(wiring));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 6 }, timeout: 30_000 }
);
