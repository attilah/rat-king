// @effect-diagnostics asyncFunction:off -- The WebCrypto signing stub is a Promise boundary.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Directory } from "@rat-king/ratking-client/directory";
import { RatKing } from "@rat-king/ratking-client/ratking";
import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { expect } from "vitest";

import { runAction } from "../../../packages/pi-ratking/src/tool.ts";
import type { ToolParamsValue } from "../../../packages/pi-ratking/src/tool.ts";
import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { runRatking } from "../src/main.ts";
import { Wiring } from "../src/session.ts";
import {
  captured,
  fakeMailbox,
  LEASE_ID,
  mail,
  people,
  seeded,
} from "./fixture.ts";

const Action = Schema.Literals(["send", "ask", "reply"]);

const Text = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9 ,.]{0,60}$/u));

const LEASES = [".acquireLease", ".renewLease", ".releaseLease"];

const leaseCalls = (calls: readonly { readonly nsid: string }[]) =>
  calls.filter((call) => LEASES.some((lease) => call.nsid.endsWith(lease)));

const Outcome = Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean }));

const facts = {
  alive: () => false,
  env: Option.some("tester"),
  pane: Option.none(),
  pid: 1,
  reads: false,
  session: "leases",
};

const holderOf = (did: string) => ({
  did,
  expiresAt: "2099-01-01T00:00:00.000Z",
  generation: 7,
  harness: {
    $type: "sh.mschf.ratking.runtime.lease#pi",
    sessionId: "pi-session-live",
  },
  leaseId: LEASE_ID,
});

const cliArgs = (action: "ask" | "reply" | "send", body: string, id: string) =>
  action === "reply"
    ? ["reply", id, "--as", "tester", "--body", body, "--json"]
    : [action, "--as", "tester", "--to", "peer", "--body", body, "--json"];

const toolParams = (
  action: "ask" | "reply" | "send",
  body: string,
  id: string
): ToolParamsValue =>
  action === "reply"
    ? { action, message: body, replyTo: id, to: "peer" }
    : { action, message: body, to: "peer" };

it.live.prop(
  "send, ask and reply make zero acquire, renew or release calls, from the CLI and from a send-only tool, and still succeed while a live holder has the lease",
  [Action, Schema.Boolean, Text],
  ([action, held, body]) =>
    Effect.gen(function* noLeaseCalls() {
      const fs = yield* FileSystem.FileSystem;
      const who = yield* people;
      const secrets = seeded(who);

      const question = yield* mail(who, 1, "accepted", {
        body: "question",
        cc: [],
        kind: "ask",
        thread: "thread-1",
      });

      const id = question.event.receipt.message.messageId;
      const holder = held ? holderOf(who.tester.did) : undefined;
      const viaCli = fakeMailbox([question], holder);
      const viaTool = fakeMailbox([question], holder);
      const out = captured();

      const wiring = harness(
        yield* fs.makeTempDirectoryScoped(),
        viaCli.http,
        [],
        { secrets }
      );

      yield* Directory.use((directory) =>
        directory.record("peer", who.peerDocument)
      ).pipe(Effect.provide(wiring));

      yield* runRatking(cliArgs(action, body, id)).pipe(
        Effect.provideService(Console.Console, out.console),
        Effect.provideService(Wiring, wiring)
      );

      const done = yield* Schema.decodeUnknownEffect(Outcome)(
        out.stdout.join("\n")
      );

      expect(done.ok).toBe(true);
      expect(viaCli.sends.length).toBeGreaterThan(0);
      expect(leaseCalls(viaCli.calls)).toEqual([]);
      expect(viaCli.lease()).toEqual(holder);

      yield* Effect.gen(function* tool() {
        yield* Directory.use((directory) =>
          directory.record("peer", who.peerDocument)
        );
        yield* (yield* RatKing).run(facts, () => Effect.void);

        const result = yield* runAction(
          "ratking",
          "10 minutes",
          toolParams(action, body, id)
        );

        expect(result.isError).toBe(action === "ask");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          harness(yield* fs.makeTempDirectoryScoped(), viaTool.http, [], {
            secrets,
          })
        )
      );

      expect(viaTool.sends.length > 0).toBe(action !== "ask");
      expect(leaseCalls(viaTool.calls)).toEqual([]);
      expect(viaTool.lease()).toEqual(holder);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 18 }, timeout: 120_000 }
);
