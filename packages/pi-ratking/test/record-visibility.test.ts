import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  Arbitrary,
  Effect,
  FileSystem,
  Match,
  Option,
  Result,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { expect } from "vitest";

import { document, identity } from "../../mailbox-client/test/identity.ts";
import { Directory } from "../src/directory.ts";
import { RatKing } from "../src/ratking.ts";
import { recordNotice } from "../src/record-visibility.ts";
import { notDeliveredText } from "../src/tool.ts";
import { harness } from "./harness.ts";

it.prop(
  "unrenderable records have a compact notice, while relay copies remain silent",
  [Arbitrary.schema(Schema.String), Arbitrary.schema(Schema.Boolean)],
  ([id, verified]) => {
    const inbound = {
      body: JSON.stringify({ $type: "sh.example.record.item" }),
      did: "did:web:peer.example.invalid",
      from: "peer",
      id,
      verified,
    };

    expect(recordNotice(inbound, false)).toBe(
      `📦 record sh.example.record.item from ${verified ? "peer" : inbound.did} (id ${id}), not rendered by this reader`
    );
    expect(recordNotice({ ...inbound, body: "not JSON" }, false)).toContain(
      "record unknown from"
    );
    expect(
      recordNotice(
        {
          ...inbound,
          body: JSON.stringify({ $type: "sh.mschf.ratking.relay#outbound" }),
        },
        false
      )
    ).toBeUndefined();
    expect(
      recordNotice(
        {
          ...inbound,
          body: JSON.stringify({
            $type: "sh.mschf.agentgraph.outcome",
            checkIn: "proof",
            gate: "pass",
            outcome: "committed",
            version: "0.1",
          }),
        },
        false
      )
    ).toBeUndefined();
    expect(recordNotice(inbound, true)).toBeUndefined();
  }
);

it.live.prop(
  "record sends guard held readers before sealing and reuse one presence lookup",
  [
    Arbitrary.schema(
      Schema.Literals([
        "old",
        "empty",
        "match",
        "exact",
        "wrong",
        "unheld",
        "failed",
      ])
    ),
  ],
  ([mode]) =>
    Effect.gen(function* guard() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const peer = yield* identity("did:web:peer.agents.example.invalid");
      let sends = 0;
      let lookups = 0;

      const http = HttpClient.make((request) => {
        if (request.url.includes("getPresence")) {
          lookups += 1;

          const body = { did: peer.did, held: mode !== "unheld" };

          const renders = Match.value(mode).pipe(
            Match.when("match", () => ["sh.mschf.agentgraph.*"]),
            Match.when("exact", () => ["sh.mschf.agentgraph.outcome"]),
            Match.when("wrong", () => ["sh.example.*"]),
            Match.when("empty", () => []),
            Match.orElse(() => {})
          );

          if (renders !== undefined) {
            Object.assign(body, { renders });
          }

          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(body, { status: mode === "failed" ? 503 : 200 })
            )
          );
        }

        if (request.url.endsWith("mailbox.send")) {
          sends += 1;

          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({
                receipt: {
                  message: {
                    messageId: "3m7x2ka4xv22a",
                    senderDid: "did:web:tester.agents.example.invalid",
                  },
                  recipientDid: peer.did,
                  seq: sends,
                  state: "accepted",
                },
              })
            )
          );
        }

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({ error: "MailboxUnavailable" }, { status: 503 })
          )
        );
      });

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;
        yield* directory.record("peer", yield* document(peer));
        yield* ratking.run(
          {
            alive: () => false,
            env: Option.some("tester"),
            pane: Option.none(),
            pid: 1,
            session: "guard-test",
          },
          () => Effect.void
        );

        const result = yield* ratking
          .send(
            "peer",
            JSON.stringify({ $type: "sh.mschf.agentgraph.outcome" }),
            { kind: "data" }
          )
          .pipe(Effect.result);

        const refused = mode === "empty" || mode === "wrong";
        expect(Result.isFailure(result)).toBe(refused);
        expect(sends).toBe(refused ? 0 : 1);
        expect(lookups).toBe(1);

        if (Result.isFailure(result)) {
          expect(notDeliveredText(result.failure)).toBe(
            "NOT SENT: ReaderCannotRender. peer's reader doesn't render sh.mschf.agentgraph.outcome (it predates typed records or doesn't declare it). Send prose instead, or ask them to restart."
          );
        }
      }).pipe(Effect.provide(harness(state, http)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 12 } }
);
