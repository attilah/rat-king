// @effect-diagnostics asyncFunction:off -- fast-check async commands drive the real RatKing send with its captured TestClock.
/* oxlint-disable promise/prefer-await-to-callbacks -- Effect HttpClient test adapter. */
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as Defs from "@rat-king/lexicon/defs";
import {
  Arbitrary,
  Clock,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Option,
  Predicate,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expect } from "vitest";

import { document, identity } from "../../mailbox-client/test/identity.ts";
import { Directory } from "../src/directory.ts";
import { AgentName } from "../src/name.ts";
import { PresenceTimeout } from "../src/presence.ts";
import { RatKing } from "../src/ratking.ts";
import { notDeliveredText } from "../src/tool.ts";
import { harness } from "./harness.ts";

type Server =
  | { readonly kind: "held" }
  | { readonly kind: "never" }
  | { readonly kind: "released"; readonly at: number };

const facts = {
  alive: () => false,
  env: Option.some("tester"),
  pane: Option.none(),
  pid: 1,
  session: "test-session",
};

const accepted = (request: HttpClientRequest.HttpClientRequest, seq: number) =>
  Effect.gen(function* acceptSend() {
    if (!Predicate.isTagged(request.body, "Uint8Array")) {
      return HttpClientResponse.fromWeb(
        request,
        Response.json({ error: "InvalidRequest" }, { status: 400 })
      );
    }

    const input = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Struct({ envelope: Defs.EncryptedEnvelope }))
    )(new TextDecoder().decode(request.body.body)).pipe(Effect.orDie);

    return HttpClientResponse.fromWeb(
      request,
      Response.json({
        receipt: {
          message: {
            messageId: input.envelope.aad.messageId,
            senderDid: input.envelope.aad.senderDid,
          },
          recipientDid: input.envelope.aad.recipientDid,
          seq,
          state: "accepted",
        },
      })
    );
  });

const isPresence = (request: HttpClientRequest.HttpClientRequest) =>
  request.url.includes("sh.mschf.ratking.mailbox.getPresence");

const isSend = (request: HttpClientRequest.HttpClientRequest) =>
  request.url.endsWith("sh.mschf.ratking.mailbox.send");

const unavailable = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClientResponse.fromWeb(
    request,
    Response.json({ error: "MailboxUnavailable" }, { status: 503 })
  );

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const expectedAge = (millis: number) => {
  const seconds = Math.floor(millis / 1000);

  if (seconds < 60) {
    return `${seconds} s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min`;
  }

  return seconds < 172_800
    ? `${Math.floor(seconds / 3600)} h`
    : `${Math.floor(seconds / 86_400)} d`;
};

const expectedLine = (server: Server, now: number) => {
  if (server.kind === "held") {
    return Option.none<string>();
  }

  if (server.kind === "never") {
    return Option.some(
      "No reader has ever held this name; the message waits in its mailbox."
    );
  }

  return Option.some(
    `No reader holding this name since ${expectedAge(now - server.at)} ago (${iso(server.at)}); the message waits in its mailbox.`
  );
};

interface Model {
  server: Server;
  cache?: { readonly at: number; readonly server: Server };
  fetches: number;
  now: number;
}

interface Real {
  readonly setServer: (server: Server) => void;
  readonly fetches: () => number;
  readonly send: () => Promise<Option.Option<string>>;
  readonly advance: (millis: number) => Promise<void>;
}

const Spec = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["held", "never", "send"]) }),
  Schema.Struct({
    ago: Schema.Int.check(
      Schema.isBetween({ maximum: 400_000_000, minimum: 0 })
    ),
    kind: Schema.Literal("released"),
  }),
  Schema.Struct({
    kind: Schema.Literal("advance"),
    millis: Schema.Int.check(
      Schema.isBetween({ maximum: 90_000_000, minimum: 1 })
    ),
  }),
]);

type SpecValue = typeof Spec.Type;

const command = (spec: SpecValue): fc.AsyncCommand<Model, Real> => ({
  check: () => true,
  run: async (model, real) => {
    switch (spec.kind) {
      case "held":
      case "never": {
        model.server = { kind: spec.kind };
        real.setServer(model.server);
        break;
      }

      case "released": {
        model.server = { at: model.now - spec.ago, kind: "released" };
        real.setServer(model.server);
        break;
      }

      case "advance": {
        await real.advance(spec.millis);
        model.now += spec.millis;
        break;
      }

      case "send": {
        if (model.cache === undefined || model.now - model.cache.at >= 30_000) {
          model.cache = { at: model.now, server: model.server };
          model.fetches += 1;
        }

        expect(await real.send()).toEqual(
          expectedLine(model.cache.server, model.now)
        );
        break;
      }

      default: {
        const exhaustive: never = spec;

        throw new Error(String(exhaustive));
      }
    }

    expect(real.fetches()).toBe(model.fetches);
  },
  toString: () => JSON.stringify(spec),
});

it.effect.prop(
  "an accepted send reports when nobody holds the recipient's name, from a presence cached for at most 30 s",
  [Arbitrary.array(Arbitrary.schema(Spec), { maxLength: 20 })],
  ([specs]) =>
    Effect.gen(function* presenceModel() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      let server: Server = { kind: "never" };
      let fetches = 0;
      let seq = 0;

      const http = HttpClient.make((request) =>
        Effect.gen(function* fakeMailbox() {
          if (isPresence(request)) {
            fetches += 1;

            const body = {
              did: "did:web:peer.agents.example.invalid",
              held: server.kind === "held",
            };

            if (server.kind === "released") {
              Object.assign(body, { lastHeldAt: iso(server.at) });
            }

            if (server.kind === "held") {
              Object.assign(body, {
                lastHeldAt: iso(yield* Clock.currentTimeMillis),
              });
            }

            return HttpClientResponse.fromWeb(request, Response.json(body));
          }

          if (isSend(request)) {
            seq += 1;

            return yield* accepted(request, seq);
          }

          return unavailable(request);
        })
      );

      const peer = yield* identity("did:web:peer.agents.example.invalid");

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record("peer", yield* document(peer));
        yield* ratking.run(facts, () => Effect.void);

        const context = yield* Effect.context();

        const run = async <A, E>(effect: Effect.Effect<A, E>) =>
          // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- fast-check AsyncCommand requires a Promise; the owning property uses it.effect and this captured TestClock.
          await Effect.runPromiseWith(context)(effect);

        const real: Real = {
          advance: async (millis) => {
            await run(TestClock.adjust(Duration.millis(millis)));
          },
          fetches: () => fetches,
          send: async () =>
            await run(
              ratking
                .send("peer", "hello")
                .pipe(
                  Effect.map((delivered) =>
                    Option.fromNullishOr(delivered.presence)
                  )
                )
            ),
          setServer: (next) => {
            server = next;
          },
        };

        const model: Model = {
          fetches: 0,
          now: yield* Clock.currentTimeMillis,
          server,
        };

        const required: SpecValue[] = [
          { kind: "send" },
          { ago: 50_400_000, kind: "released" },
          { kind: "send" },
          { kind: "advance", millis: 30_000 },
          { kind: "send" },
          { kind: "held" },
          { kind: "advance", millis: 30_000 },
          { kind: "send" },
        ];

        yield* Effect.promise(async () => {
          await fc.asyncModelRun(
            () => ({ model, real }),
            [...required, ...specs].map(command)
          );
        });
      }).pipe(Effect.provide(harness(state, http)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 }, timeout: 120_000 }
);

const Failure = Schema.Literals(["status", "text", "malformed", "hang"]);

it.live.prop(
  "a presence lookup that fails, answers garbage or hangs never fails or blocks an accepted send",
  [Arbitrary.schema(Failure)],
  ([failure]) =>
    Effect.gen(function* silentPresence() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      let seq = 0;

      const http = HttpClient.make((request) => {
        if (isSend(request)) {
          seq += 1;

          return accepted(request, seq);
        }

        if (!isPresence(request)) {
          return Effect.succeed(unavailable(request));
        }

        switch (failure) {
          case "status": {
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({ error: "Boom" }, { status: 500 })
              )
            );
          }

          case "text": {
            return Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response("not json"))
            );
          }

          case "malformed": {
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({ held: "maybe" })
              )
            );
          }

          case "hang": {
            return Effect.never;
          }

          default: {
            const exhaustive: never = failure;

            throw new Error(String(exhaustive));
          }
        }
      });

      const peer = yield* identity("did:web:peer.agents.example.invalid");

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record("peer", yield* document(peer));
        yield* ratking.run(facts, () => Effect.void);

        const delivered = yield* ratking.send("peer", "hello").pipe(
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () => Effect.die(new Error("Presence blocked the send")),
          })
        );

        expect(delivered.seq).toBe(1);
        expect(delivered.presence).toBeUndefined();
      }).pipe(
        Effect.provide(harness(state, http)),
        Effect.provideService(PresenceTimeout, Duration.millis(200))
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 8 }, timeout: 60_000 }
);

it.live.prop(
  "a send to a retired name is NOT DELIVERED: Retired with the server's successor line, and is not retried",
  [Arbitrary.schema(Schema.Option(AgentName))],
  ([successor]) =>
    Effect.gen(function* retiredSend() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      let sends = 0;

      const line = `peer was retired at 2026-10-11T00:05:00.000Z; ${Option.match(
        successor,
        {
          onNone: () => "no successor",
          onSome: (name) => `current row is ${name}`,
        }
      )}`;

      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          if (!isSend(request)) {
            return unavailable(request);
          }

          sends += 1;

          return HttpClientResponse.fromWeb(
            request,
            Response.json({ error: "Retired", message: line }, { status: 410 })
          );
        })
      );

      const peer = yield* identity("did:web:peer.agents.example.invalid");

      yield* Effect.gen(function* proof() {
        const directory = yield* Directory;
        const ratking = yield* RatKing;

        yield* directory.record("peer", yield* document(peer));
        yield* ratking.run(facts, () => Effect.void);

        const refused = yield* ratking.send("peer", "hello").pipe(Effect.flip);

        expect(refused.code).toBe("Retired");
        expect(notDeliveredText(refused)).toBe(
          `NOT DELIVERED: Retired. ${line}. No intercom fallback; nothing reached the recipient.`
        );
        expect(sends).toBe(1);
      }).pipe(Effect.provide(harness(state, http)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 5 }, timeout: 60_000 }
);
