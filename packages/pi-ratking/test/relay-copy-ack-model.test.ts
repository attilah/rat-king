// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary under test.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type * as Defs from "@rat-king/lexicon/defs";
import * as List from "@rat-king/lexicon/mailbox.list";
import { ownIdentity, prepare } from "@rat-king/mailbox-client";
import { Directory } from "@rat-king/ratking-client/directory";
import { PayloadJson } from "@rat-king/ratking-client/payload";
import { SecretStore } from "@rat-king/ratking-client/secrets";
import {
  Clock,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Match,
  Option,
  Predicate,
  Redacted,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { expect } from "vitest";

import { WebSocketPort } from "../../mailbox-client/src/watch.ts";
import { document, identity } from "../../mailbox-client/test/identity.ts";
import { ratkingExtension } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { harness } from "./harness.ts";
import { startSession } from "./start-session.ts";

const ENDPOINT = "https://mailbox.example.invalid";

const SERVICE = "did:web:mailbox.example.invalid";

const didOf = (name: string) => `did:web:${name}.agents.example.invalid`;

const Variant = Schema.Literals(["outbound", "handled"]);

const Copies = Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 1 }));

interface Stored {
  acked: boolean;
  delivered: boolean;
  readonly envelope: Defs.EncryptedEnvelopeValue;
  readonly id: string;
  readonly seq: number;
  readonly senderDid: string;
}

const socketPort = Layer.succeed(WebSocketPort, {
  connect: () => {
    const events = new EventTarget();

    return {
      addEventListener: (type, listener, options) => {
        events.addEventListener(type, listener, options);
      },
      close: () => {},
      readyState: 1,
      removeEventListener: (type, listener) => {
        events.removeEventListener(type, listener);
      },
      send: () => {
        queueMicrotask(() => {
          events.dispatchEvent(
            new MessageEvent("message", { data: JSON.stringify({ seq: 1 }) })
          );
        });
      },
    };
  },
});

const json = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  body: typeof Schema.Json.Type
) => HttpClientResponse.fromWeb(request, Response.json(body));

const noop = async () => {};

interface Hooks {
  end: () => Promise<void>;
  start: (facts: SessionStart) => Promise<void>;
}

const until = (check: () => boolean) =>
  Effect.suspend(() => (check() ? Effect.void : Effect.fail("waiting"))).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 600 }),
    Effect.ignore
  );

it.live.prop(
  "relay context copies that Pi never renders are acked once recorded, so a restart on a new lease generation redelivers none of them; mail nobody has seen is still redelivered once",
  [Copies, Variant],
  ([copies, variant]) =>
    Effect.gen(function* copyAckModel() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();

      const sender = variant === "handled" ? "staff" : "desk";

      const people = {
        ea: yield* identity(didOf("ea")),
        sender: yield* identity(didOf(sender)),
      };

      const documents = {
        ea: yield* document(people.ea),
        [sender]: yield* document(people.sender),
      };

      const noHttp = HttpClient.make((request) =>
        Effect.die(`Unexpected request ${request.url}`)
      );

      const stored: Stored[] = [];

      const seal = (build: (id: string) => string) =>
        Effect.gen(function* sealFromDesk() {
          const client = yield* prepare({
            endpoint: ENDPOINT,
            own: yield* ownIdentity(people.sender),
            peers: [documents.ea],
            serviceDid: SERVICE,
          });

          const envelope = yield* client.seal(people.ea.did, build, {
            encrypt: true,
          });

          stored.push({
            acked: false,
            delivered: false,
            envelope,
            id: envelope.aad.messageId,
            senderDid: people.sender.did,
            seq: stored.length + 1,
          });

          return envelope.aad.messageId;
        }).pipe(
          Effect.scoped,
          Effect.provideService(HttpClient.HttpClient, noHttp)
        );

      const copyIds: string[] = [];

      for (let index = 0; index < copies; index += 1) {
        copyIds.push(
          yield* seal((id) =>
            JSON.stringify(
              variant === "handled"
                ? {
                    $type: "sh.mschf.ratking.relay#handled",
                    id: `original-${index}-${id}`,
                  }
                : {
                    $type: "sh.mschf.ratking.relay#outbound",
                    body: `copy-${index}`,
                    cc: [],
                    encrypted: true,
                    id,
                    kind: "message",
                    replyTo: null,
                    summary: null,
                    thread: id,
                    to: "carol",
                  }
            )
          )
        );
      }

      const unseen = yield* seal((id) =>
        Schema.encodeSync(PayloadJson)({
          body: "never shown",
          from: sender,
          thread: id,
          to: "ea",
        })
      );

      let generation = 0;
      const acks: string[] = [];
      const deliveries = new Map<string, number>();

      const leaseUntil = DateTime.formatIso(
        DateTime.makeUnsafe((yield* Clock.currentTimeMillis) + 300_000)
      );

      const receiptOf = (entry: Stored, phase: string) => ({
        message: { messageId: entry.id, senderDid: entry.senderDid },
        recipientDid: people.ea.did,
        seq: entry.seq,
        state: phase,
      });

      const http = HttpClient.make((request) =>
        Effect.gen(function* mailbox() {
          const nsid = new URL(request.url).pathname.replace("/xrpc/", "");

          const input: unknown = Predicate.isTagged(request.body, "Uint8Array")
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : {};

          return yield* Match.value(nsid).pipe(
            Match.when("sh.mschf.ratking.mailbox.list", () =>
              Effect.gen(function* list() {
                const open = stored.filter((entry) => !entry.acked);

                const output = yield* Schema.decodeUnknownEffect(
                  Schema.toType(List.Output)
                )({
                  events:
                    generation === 0
                      ? []
                      : open.map((entry) => ({
                          $type: "sh.mschf.ratking.defs#messageEvent",
                          envelope: entry.envelope,
                          receipt: receiptOf(
                            entry,
                            entry.delivered ? "delivered" : "accepted"
                          ),
                          seq: entry.seq,
                        })),
                  throughSeq: generation === 0 ? 0 : stored.length,
                });

                return HttpClientResponse.fromWeb(
                  request,
                  new Response(
                    yield* Schema.encodeEffect(
                      Schema.fromJsonString(List.Output)
                    )(output),
                    { headers: { "content-type": "application/json" } }
                  )
                );
              })
            ),
            Match.when("sh.mschf.ratking.runtime.acquireLease", () =>
              Effect.sync(() => {
                generation += 1;

                return json(request, {
                  lease: {
                    did: people.ea.did,
                    expiresAt: leaseUntil,
                    generation,
                    harness: {
                      $type: "sh.mschf.ratking.runtime.lease#pi",
                      sessionId: "ea",
                    },
                    leaseId: `3mxcx45mn7se${"abcdefg".charAt(generation)}`,
                  },
                });
              })
            ),
            Match.when("sh.mschf.ratking.mailbox.deliver", () =>
              Effect.sync(() => {
                const entry = stored.find(
                  (each) =>
                    Predicate.hasProperty(input, "message") &&
                    Predicate.hasProperty(input.message, "messageId") &&
                    each.id === input.message.messageId
                );

                if (entry === undefined) {
                  return json(request, { error: "NotFound" });
                }

                entry.delivered = true;
                deliveries.set(entry.id, (deliveries.get(entry.id) ?? 0) + 1);

                return json(request, {
                  receipt: receiptOf(entry, "delivered"),
                });
              })
            ),
            Match.when("sh.mschf.ratking.mailbox.ack", () =>
              Effect.sync(() => {
                const entry = stored.find(
                  (each) =>
                    Predicate.hasProperty(input, "message") &&
                    Predicate.hasProperty(input.message, "messageId") &&
                    each.id === input.message.messageId
                );

                if (entry === undefined) {
                  return json(request, { error: "NotFound" });
                }

                entry.acked = true;
                acks.push(entry.id);

                return json(request, { receipt: receiptOf(entry, "acked") });
              })
            ),
            Match.when("sh.mschf.ratking.runtime.releaseLease", () =>
              Effect.succeed(
                HttpClientResponse.fromWeb(request, new Response(null))
              )
            ),
            Match.orElse(() =>
              Effect.succeed(json(request, { error: "NotFound" }))
            )
          );
        }).pipe(Effect.orDie)
      );

      const layer = Layer.effectDiscard(
        Effect.gen(function* seed() {
          const secrets = yield* SecretStore;
          const directory = yield* Directory;
          yield* secrets.add(
            "rat_king_fleet_agent_ea_identity",
            Redacted.make(JSON.stringify(people.ea))
          );

          for (const [name, value] of Object.entries(documents)) {
            yield* directory.record(name, value);
          }
        })
      ).pipe(
        Layer.orDie,
        Layer.provideMerge(
          harness(
            state,
            http,
            [],
            variant === "handled"
              ? {
                  relays: [
                    {
                      fallbackMinutes: 10,
                      mode: "front",
                      name: "ea",
                      to: "staff",
                    },
                  ],
                }
              : {}
          ).pipe(Layer.provideMerge(socketPort))
        )
      );

      const arrivals = new Map<string, number>();

      const session = () =>
        Effect.gen(function* oneSession() {
          const hooks: Hooks = { end: noop, start: noop };

          const pi: PiHost = {
            events: {
              emit: (_channel, payload) => {
                if (Predicate.hasProperty(payload, "id")) {
                  const id = String(payload.id);
                  arrivals.set(id, (arrivals.get(id) ?? 0) + 1);
                }
              },
              on: () => () => {},
            },
            onMessageShown: () => {},
            onSessionEnd: (handler) => {
              hooks.end = handler;
            },
            onSessionStart: (handler) => {
              hooks.start = handler;
            },
            registerMessageRenderer: () => {},
            registerTool: () => {},
            sendMessage: () => {},
          };

          yield* Effect.promise(async () => {
            await ratkingExtension({
              facts: (id) =>
                Effect.succeed({
                  alive: () => false,
                  env: Option.some("ea"),
                  pane: Option.none(),
                  pid: 1,
                  reads: true,
                  session: id,
                }),
              layer,
              tool: Effect.succeed("ratking"),
            })(pi);
            await startSession(hooks.start, { session: "ea", warn: () => {} });
          });

          return hooks.end;
        });

      const firstEnd = yield* session();

      yield* until(() => arrivals.has(unseen));
      yield* until(() => acks.length >= copies);
      yield* Effect.sleep("30 millis");

      expect([...acks].toSorted()).toEqual([...copyIds].toSorted());
      expect(arrivals.get(unseen)).toBe(1);

      yield* Effect.promise(async () => {
        await firstEnd();
      });

      const secondEnd = yield* session();

      yield* until(() => (arrivals.get(unseen) ?? 0) >= 2);
      yield* Effect.sleep("60 millis");

      expect(arrivals.get(unseen)).toBe(2);
      expect(deliveries.get(unseen)).toBe(2);

      for (const id of copyIds) {
        expect(deliveries.get(id)).toBe(1);
      }

      expect([...acks].toSorted()).toEqual([...copyIds].toSorted());

      yield* Effect.promise(async () => {
        await secondEnd();
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 5 }, timeout: 120_000 }
);
