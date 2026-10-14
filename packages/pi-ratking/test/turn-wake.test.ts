// @effect-diagnostics asyncFunction:off -- fast-check asyncModelRun drives Effect programs.
/* oxlint-disable typescript/promise-function-async, promise/prefer-await-to-callbacks -- fast-check asyncModelRun is the model boundary. */
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import * as List from "@rat-king/lexicon/mailbox.list";
import { Turn } from "@rat-king/lexicon/turns";
import { ownIdentity, prepare } from "@rat-king/mailbox-client";
import { Directory } from "@rat-king/ratking-client/directory";
import { renderInbound } from "@rat-king/ratking-client/payload";
import { RatKing } from "@rat-king/ratking-client/ratking";
import type { Deliver } from "@rat-king/ratking-client/ratking";
import { SecretStore } from "@rat-king/ratking-client/secrets";
import {
  Arbitrary,
  Clock,
  DateTime,
  Redacted,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import {
  defaultPreferences,
  defaultStatus,
} from "../../mailbox-client/src/attention.ts";
import { WebSocketPort } from "../../mailbox-client/src/watch.ts";
import { document, identity } from "../../mailbox-client/test/identity.ts";
import { ratkingExtension, RECORD_EVENT } from "../src/extension.ts";
import type {
  ExtensionOptions,
  PiHost,
  SessionStart,
} from "../src/extension.ts";
import { inboundLines } from "../src/message-view.ts";
import { shownIds } from "../src/pending.ts";
import type { PendingMail } from "../src/pending.ts";
import {
  shownTurnKeys,
  turnInbox,
  turnKey,
  turnWake,
  TURN_SHOWN_ENTRY,
} from "../src/wake-record.ts";
import { harness } from "./harness.ts";
import { plainTheme } from "./view-arbitraries.ts";

const State = Schema.Literals([
  "done",
  "blocked",
  "crashed",
  "working",
  "idle",
]);

const Input = Schema.Struct({
  idle: Schema.Boolean,
  n: Schema.Int.check(Schema.isBetween({ maximum: 999, minimum: 1 })),
  settled: Schema.Boolean,
  signer: Schema.Literals(["peer", "operator", "impostor"]),
  state: State,
  verified: Schema.Boolean,
});

const record = (state: typeof State.Type, n = 1) => {
  const value = {
    $type: "sh.mschf.agentgraph.turn" as const,
    agent: "peer",
    at: "2030-01-01T00:00:00Z",
    session: "peer-session",
    state,
    turnId: `peer-session:${n}`,
    version: "0.1",
  };

  return state === "done" ? { ...value, stopReason: "stop" as const } : value;
};

const arrival = (
  value: ReturnType<typeof record>,
  id: string,
  verified = true,
  from = "peer"
) => ({
  did: "did:web:peer.example.invalid",
  from,
  id,
  levers: {
    enabled: true,
    owner: "owner",
    prefs: { ...defaultPreferences(), refuse: ["peer"] },
    status: { ...defaultStatus(), state: "dnd" },
  },
  record: value,
  replyTo: Option.none<string>(),
  verified,
});

const nothing = () => {};

const noop = async () => {};

const ignoreDelivery: Deliver = () => Effect.void;

const socket = Layer.succeed(WebSocketPort, {
  connect: () => {
    const events = new EventTarget();

    return {
      addEventListener: (type, listener, options) => {
        events.addEventListener(type, listener, options);
      },
      close: nothing,
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

const reader = (
  state: string,
  options: {
    readonly layer?: ExtensionOptions["layer"];
    readonly notify?: () => void;
  } = {}
) =>
  Effect.gen(function* makeReader() {
    let start: (facts: SessionStart) => Promise<void> = noop;
    let stop: () => Promise<void> = noop;
    let shown: (id: string) => void = nothing;
    let deliver = ignoreDelivery;

    const sends: {
      readonly content: unknown;
      readonly customType: string;
      readonly details?: unknown;
    }[] = [];

    const deliveries: unknown[] = [];
    const events: unknown[] = [];
    const keys: string[] = [];
    const settled: string[] = [];

    const pi: PiHost = {
      events: {
        emit: (event, value) => {
          if (event === RECORD_EVENT) {
            events.push(value);
          }
        },
        on: () => nothing,
      },
      noteSettledRecord: (id) => {
        settled.push(id);
      },
      onMessageShown: (handler) => {
        shown = handler;
      },
      onSessionEnd: (handler) => {
        stop = handler;
      },
      onSessionStart: (handler) => {
        start = handler;
      },
      registerMessageRenderer: nothing,
      registerTool: nothing,
      sendMessage: (message, delivery) => {
        sends.push(message);
        deliveries.push(delivery);
        options.notify?.();
      },
    };

    yield* Effect.promise(async () => {
      await ratkingExtension({
        facts: (session) =>
          Effect.succeed({
            alive: () => true,
            env: Option.some("owner"),
            pane: Option.none(),
            pid: 1,
            reads: true,
            session,
          }),
        layer:
          options.layer ??
          Layer.merge(
            harness(
              state,
              HttpClient.make(() => Effect.die("Unexpected HTTP"))
            ),
            Layer.mock(RatKing, {
              run: (_facts, handler) =>
                Effect.sync(() => {
                  deliver = handler;
                }),
            })
          ),
        tool: Effect.succeed("ratking"),
      })(pi);
    });
    yield* Effect.addFinalizer(() => Effect.promise(stop));

    return {
      deliver: (
        inbound: Parameters<Deliver>[0],
        settledRecord: boolean,
        ack: Effect.Effect<void>
      ) => deliver(inbound, settledRecord, ack),
      deliveries,
      events,
      keys,
      sends,
      settled,
      shown: (id: string) => {
        shown(id);
      },
      start: (isIdle: boolean) =>
        Effect.promise(async () => {
          await start({
            isIdle: () => isIdle,
            rememberShownTurn: (key) => {
              keys.push(key);
            },
            session: "owner-session",
            shownTurns: [...keys],
            warn: (message) => {
              throw new Error(message);
            },
          });
        }),
    };
  });

it.effect.prop(
  "verified signed terminal turns wake idle and busy owners once, emit every hook, and acknowledge only at display across restart",
  [Arbitrary.schema(Input)],
  ([input]) =>
    Effect.gen(function* turnCustody() {
      const fs = yield* FileSystem.FileSystem;
      const real = yield* reader(yield* fs.makeTempDirectoryScoped());
      yield* real.start(input.idle);
      const turn = record(input.state, input.n);
      const inbound = arrival(turn, "first", input.verified, input.signer);

      const wakes =
        input.verified &&
        input.signer !== "impostor" &&
        !input.settled &&
        ["done", "blocked", "crashed"].includes(input.state);

      const acked = yield* Deferred.make<boolean>();
      const acknowledgments: string[] = [];

      const ack = (id: string) =>
        Effect.sync(() => {
          acknowledgments.push(id);
        }).pipe(Effect.andThen(Deferred.succeed(acked, true)), Effect.asVoid);

      yield* real.deliver(inbound, input.settled, ack("first"));
      expect(real.events).toHaveLength(1);
      expect(real.sends).toHaveLength(wakes ? 1 : 0);
      expect(Option.isSome(turnWake(inbound, input.settled, new Set()))).toBe(
        wakes
      );

      if (!wakes) {
        yield* Deferred.await(acked);
        expect(acknowledgments).toEqual(["first"]);

        return;
      }

      expect(real.deliveries).toEqual([
        { deliverAs: input.idle ? "followUp" : "steer", triggerTurn: true },
      ]);
      expect(real.sends[0]?.content).toBe(
        `turn · peer · ${input.state} · ${"stopReason" in turn ? turn.stopReason : ""}`
      );
      expect(real.keys).toEqual([]);
      expect(acknowledgments).toEqual([]);
      yield* real.deliver(
        { ...inbound, id: "duplicate" },
        false,
        ack("duplicate")
      );
      expect(real.sends).toHaveLength(1);
      expect(real.events).toHaveLength(2);
      expect(acknowledgments).toEqual([]);
      const [message] = real.sends;
      expect(message).toBeDefined();

      if (message !== undefined) {
        for (const id of shownIds({ ...message, role: "custom" })) {
          real.shown(id);
        }
      }

      yield* Deferred.await(acked);
      yield* Effect.yieldNow;
      expect(acknowledgments).toEqual(["first", "duplicate"]);
      expect(real.keys).toEqual([turnKey(turn)]);
      yield* real.start(input.idle);
      yield* real.deliver({ ...inbound, id: "replay" }, false, ack("replay"));
      yield* Effect.yieldNow;
      expect(real.sends).toHaveLength(1);
      expect(real.events).toHaveLength(3);
      expect(acknowledgments).toEqual(["first", "duplicate", "replay"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 150 } }
);

const Operation = Schema.Literals([
  "done",
  "blocked",
  "crashed",
  "working",
  "idle",
  "shown",
  "restart",
]);

interface Model {
  acked: string[];
  displayed: Set<string>;
  pending: Map<string, string[]>;
  sent: string[];
}

interface Real {
  acked: string[];
  box: ReturnType<typeof turnInbox>;
  keys: string[];
  mails: PendingMail[];
}

it.effect.prop(
  "turn custody model: replay, state transitions, display and restart preserve one wake per turn/state without losing pending custody",
  [Arbitrary.schema(Schema.Array(Operation).check(Schema.isMaxLength(40)))],
  ([operations]) =>
    Effect.promise(async () => {
      const commands: AsyncCommand<Model, Real>[] = [
        "done",
        "done",
        "restart",
        "done",
        "shown",
        "restart",
        "done",
        "blocked",
        "shown",
        ...operations,
      ].map((value, index) => {
        const operation = Schema.decodeUnknownSync(Operation)(value);

        return {
          check: () => true,
          run: async (model, real) => {
            if (operation === "restart") {
              model.pending.clear();
              real.box.restore(real.keys, (key) => {
                real.keys.push(key);
              });
            } else if (operation === "shown") {
              for (const [key, ids] of model.pending) {
                model.displayed.add(key);
                model.acked.push(...ids);
                real.box.shown(ids[0] ?? "");
              }

              model.pending.clear();
            } else {
              const id = String(index);

              const terminal = ["done", "blocked", "crashed"].includes(
                operation
              );

              const ids = model.pending.get(operation);

              if (!terminal || model.displayed.has(operation)) {
                model.acked.push(id);
              } else if (ids === undefined) {
                model.pending.set(operation, [id]);
                model.sent.push(operation);
              } else {
                ids.push(id);
              }

              real.box.receive(arrival(record(operation), id), false);
            }

            expect(real.acked).toEqual(model.acked);
            expect(
              real.mails
                .map(
                  (mail) =>
                    Schema.decodeUnknownSync(
                      Schema.Struct({ body: Schema.String })
                    )(mail.details).body
                )
                .map(
                  (body) =>
                    Schema.decodeUnknownSync(Schema.fromJsonString(Turn))(body)
                      .state
                )
            ).toEqual(model.sent);
            await Promise.resolve();
          },
          toString: () => operation,
        };
      });

      await asyncModelRun(() => {
        const acked: string[] = [];
        const keys: string[] = [];
        const mails: PendingMail[] = [];

        const box = turnInbox({
          consume: (id) => {
            acked.push(id);
          },
          take: (mail) => {
            mails.push(mail);
          },
        });

        box.restore([], (key) => {
          keys.push(key);
        });

        return {
          model: {
            acked: [],
            displayed: new Set<string>(),
            pending: new Map(),
            sent: [],
          },
          real: { acked, box, keys, mails },
        };
      }, commands);
    })
);

it("turn receipts at width 60 retain done, blocked and crashed glyphs; replay renders nothing", () => {
  const replayMails: PendingMail[] = [];

  for (const state of ["done", "blocked", "crashed"] as const) {
    const mails: PendingMail[] = [];

    const box = turnInbox({
      consume: nothing,
      take: (mail) => {
        mails.push(mail);
      },
    });

    const value = record(state);
    box.receive(arrival(value, "capture"), false);

    const details = Schema.decodeUnknownSync(
      Schema.Struct({
        body: Schema.String,
        cc: Schema.Boolean,
        did: Schema.String,
        from: Schema.String,
        id: Schema.String,
        kind: Schema.Literal("data"),
        verified: Schema.Boolean,
      })
    )(mails[0]?.details);

    const capture = inboundLines({
      expanded: false,
      theme: plainTheme,
      tool: "ratking",
      value: details,
      width: 60,
    }).join("\n");

    expect(capture).toMatchSnapshot(state);
    box.shown("capture");
    box.receive(arrival(value, "replay"), false);
    replayMails.push(...mails.slice(1));
    expect(mails).toHaveLength(1);
    expect(
      shownTurnKeys([
        {
          customType: TURN_SHOWN_ENTRY,
          data: { key: turnKey(value) },
          type: "custom",
        },
        { customType: TURN_SHOWN_ENTRY, data: { key: 1 }, type: "custom" },
      ])
    ).toEqual([turnKey(value)]);
  }

  expect(replayMails.map((mail) => mail.content).join("\n")).toMatchSnapshot(
    "replay"
  );
});

it.effect.prop(
  "turn routing leaves non-turn message content byte-identical",
  [Schema.String],
  ([body]) =>
    Effect.gen(function* unchangedContent() {
      const fs = yield* FileSystem.FileSystem;
      const real = yield* reader(yield* fs.makeTempDirectoryScoped());
      yield* real.start(true);

      const inbound = {
        body,
        cc: false,
        did: "did:web:peer.example.invalid",
        from: "peer",
        id: "mail",
        kind: "message" as const,
        label: Option.none<string>(),
        replyTo: Option.none<string>(),
        summary: Option.none<string>(),
        verified: true,
      };

      yield* real.deliver(inbound, false, Effect.void);
      expect(real.sends.map((message) => message.content)).toEqual([
        renderInbound("ratking", inbound),
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.live.prop(
  "fake mailbox: signed done wakes, restart before display redelivers once, and only shown acknowledges",
  [Schema.Boolean],
  ([restart]) =>
    Effect.gen(function* mailboxCustody() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const own = yield* identity("did:web:owner.agents.example.invalid");
      const peer = yield* identity("did:web:peer.agents.example.invalid");
      const ownDocument = yield* document(own);
      const peerDocument = yield* document(peer);

      const envelope = yield* Effect.gen(function* sealTurn() {
        const client = yield* prepare({
          endpoint: "https://mailbox.example.invalid",
          own: yield* ownIdentity(peer),
          peers: [ownDocument],
          serviceDid: "did:web:mailbox.example.invalid",
        });

        return yield* client.seal(own.did, JSON.stringify(record("done")));
      }).pipe(
        Effect.scoped,
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected seal HTTP"))
        )
      );

      const receipt = {
        message: { messageId: envelope.aad.messageId, senderDid: peer.did },
        recipientDid: own.did,
        seq: 1,
        state: "accepted",
      };

      const expiresAt = DateTime.formatIso(
        DateTime.makeUnsafe((yield* Clock.currentTimeMillis) + 300_000)
      );

      let acquired = false;
      let generation = 0;
      let acknowledgments = 0;
      let deliveries = 0;
      const acked = yield* Deferred.make<boolean>();
      let displayed = yield* Deferred.make<boolean>();

      const http = HttpClient.make((request) =>
        Effect.gen(function* mailbox() {
          const nsid = new URL(request.url).pathname.replace("/xrpc/", "");

          if (nsid.endsWith(".list")) {
            const output = yield* Schema.decodeUnknownEffect(
              Schema.toType(List.Output)
            )({
              events: acquired
                ? [
                    {
                      $type: "sh.mschf.ratking.defs#messageEvent",
                      envelope,
                      receipt: {
                        ...receipt,
                        state: deliveries > 0 ? "delivered" : "accepted",
                      },
                      seq: 1,
                    },
                  ]
                : [],
              throughSeq: acquired ? 1 : 0,
            });

            const json = yield* Schema.encodeEffect(
              Schema.fromJsonString(List.Output)
            )(output);

            return HttpClientResponse.fromWeb(
              request,
              new Response(json, {
                headers: { "content-type": "application/json" },
              })
            );
          }

          if (
            nsid.endsWith(".acquireLease") ||
            nsid.endsWith(".resolveLease")
          ) {
            if (nsid.endsWith(".acquireLease")) {
              acquired = true;
              generation += 1;
            }

            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                lease: {
                  did: own.did,
                  expiresAt,
                  generation,
                  harness: {
                    $type: "sh.mschf.ratking.runtime.lease#pi",
                    sessionId: "owner-session",
                  },
                  leaseId: "3mxcx45mn7sex",
                },
              })
            );
          }

          if (nsid.endsWith(".deliver")) {
            deliveries += 1;

            return HttpClientResponse.fromWeb(
              request,
              Response.json({ receipt: { ...receipt, state: "delivered" } })
            );
          }

          if (nsid.endsWith(".ack")) {
            acknowledgments += 1;
            yield* Deferred.succeed(acked, true);

            return HttpClientResponse.fromWeb(
              request,
              Response.json({ receipt: { ...receipt, state: "acked" } })
            );
          }

          if (nsid.endsWith(".releaseLease")) {
            return HttpClientResponse.fromWeb(request, Response.json({}));
          }

          return yield* Effect.die(`Unexpected mailbox request ${nsid}`);
        }).pipe(Effect.orDie)
      );

      const layer = Layer.effectDiscard(
        Effect.gen(function* seedOwner() {
          const secrets = yield* SecretStore;
          const directory = yield* Directory;
          yield* secrets.add(
            "rat_king_fleet_agent_owner_identity",
            Redacted.make(JSON.stringify(own))
          );
          yield* directory.record("owner", ownDocument);
          yield* directory.record("peer", peerDocument);
        })
      ).pipe(
        Layer.orDie,
        Layer.provideMerge(
          harness(state, http).pipe(Layer.provideMerge(socket))
        )
      );

      const real = yield* reader(state, {
        layer,
        notify: () => {
          Deferred.doneUnsafe(displayed, Effect.succeed(true));
        },
      });

      yield* real.start(true);
      yield* Deferred.await(displayed);
      expect(real.sends.map((message) => message.content)).toEqual([
        "turn · peer · done · stop",
      ]);
      expect(acknowledgments).toBe(0);
      expect(real.keys).toEqual([]);

      if (restart) {
        displayed = yield* Deferred.make<boolean>();
        yield* real.start(true);
        yield* Deferred.await(displayed);
        expect(real.sends).toHaveLength(2);
        expect(acknowledgments).toBe(0);
        expect(deliveries).toBe(2);
      }

      const latest = real.sends.at(-1);
      expect(latest).toBeDefined();

      if (latest !== undefined) {
        for (const id of shownIds({ ...latest, role: "custom" })) {
          real.shown(id);
        }
      }

      yield* Deferred.await(acked);
      expect(acknowledgments).toBe(1);
      expect(real.keys).toEqual([turnKey(record("done"))]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 4 } }
);
