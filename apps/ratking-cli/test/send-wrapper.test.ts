import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { Console, Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import {
  DEPRECATION,
  sendCommand,
  wrappedArgs,
} from "../../../stacks/nest/send.ts";
import { Wiring } from "../src/session.ts";
import { captured, fakeMailbox, people, seeded } from "./fixture.ts";

const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,8}$/u));

it.prop(
  "an identity secret name given to --as becomes the agent name and every other argument passes through in order",
  [Name, Name],
  ([agent, to]) => {
    const wrapped = wrappedArgs([
      "--as",
      `rat_king_agent_${agent}_identity`,
      "--to",
      to,
      "--encrypt",
    ]);

    expect(wrapped).toEqual([
      "send",
      "--json",
      "--as",
      agent,
      "--to",
      to,
      "--encrypt",
    ]);
  }
);

it.live(
  "the deprecated send prints one deprecation line on stderr and the old {id,seq,to} line on stdout",
  () =>
    Effect.gen(function* wrapper() {
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
        directory.record("peer", who.peerDocument)
      ).pipe(Effect.provide(wiring));

      yield* sendCommand([
        "--as",
        "tester",
        "--to",
        "peer",
        "--summary",
        "hello",
        "--body",
        "hello",
      ]).pipe(
        Effect.provideService(Console.Console, out.console),
        Effect.provideService(Wiring, wiring)
      );

      expect(out.stderr).toEqual([DEPRECATION]);
      expect(out.stdout).toHaveLength(1);

      const printed = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
      )(out.stdout[0] ?? "{}");

      expect(Object.keys(printed)).toEqual(["id", "seq", "to"]);
      expect(mailbox.sends).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
