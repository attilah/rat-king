// @effect-diagnostics asyncFunction:off -- fast-check async commands drive the real Effect service with its captured TestClock.
import { it } from "@effect/vitest";
import * as Defs from "@rat-king/lexicon/defs";
import * as Acquire from "@rat-king/lexicon/runtime.acquireLease";
import type * as Lease from "@rat-king/lexicon/runtime.lease";
import * as Renew from "@rat-king/lexicon/runtime.renewLease";
import type { XrpcFailure } from "@rat-king/lexicon/xrpc-failure";
import {
  Arbitrary,
  Clock,
  DateTime,
  Effect,
  Layer,
  Match,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expect } from "vitest";

import {
  sealed,
  recipientDid,
} from "../../../packages/envelope/test/helpers.ts";
import {
  inbox,
  shownIds,
  DIGEST_MESSAGE,
  MAIL_MESSAGE,
} from "../../../packages/pi-ratking/src/pending.ts";
import { LeaseAuthority, leaseLayer, validLease } from "../src/lease.ts";
import { deliverMessage, transitionMessage } from "../src/mailbox.ts";
import { redeliver } from "../src/redelivery.ts";
import { MailboxStore } from "../src/store.ts";
import type { Message } from "../src/store.ts";
import { tid } from "../src/tid.ts";
import { testStore } from "./helpers.ts";

const Step = Schema.Literals([
  "receive",
  "show",
  "crash",
  "crashAfterDisplay",
  "handover",
  "renew",
  "resume",
]);

const Mode = Schema.Literals(["steer", "nextTurn", "digest"]);

type Plant =
  | "none"
  | "earlyAck"
  | "renewReplay"
  | "digestAck"
  | "suppressDisplayedReplay";

interface Model {
  alive: boolean;
  generation: number;
  messages: Map<string, { displayed: number; acknowledged: boolean }>;
  queued: Set<string>;
}

interface Real {
  readonly act: (
    step: typeof Step.Type,
    mode: typeof Mode.Type
  ) => Promise<void>;
  readonly check: (model: Model) => Promise<void>;
  readonly received: () => string;
  readonly shown: () => readonly string[];
}

class Command implements fc.AsyncCommand<Model, Real> {
  readonly step: typeof Step.Type;
  readonly mode: typeof Mode.Type;

  constructor(step: typeof Step.Type, mode: typeof Mode.Type) {
    this.step = step;
    this.mode = mode;
  }
  check(model: Readonly<Model>) {
    return model.alive || this.step === "handover";
  }
  async run(model: Model, real: Real) {
    await real.act(this.step, this.mode);

    switch (this.step) {
      case "receive": {
        const id = real.received();

        model.messages.set(id, { acknowledged: false, displayed: 0 });
        model.queued.add(id);
        break;
      }

      case "show":
      case "crashAfterDisplay": {
        for (const id of real.shown()) {
          const message = model.messages.get(id);

          expect(message).toBeDefined();
          expect(
            message?.acknowledged,
            "a successfully acknowledged message must never be shown again"
          ).toBe(false);
          expect(
            model.queued.has(id),
            "each queued copy is displayed only once in its generation"
          ).toBe(true);
          model.messages.set(id, {
            acknowledged: this.step === "show",
            displayed: (message?.displayed ?? 0) + 1,
          });
          model.queued.delete(id);
        }

        if (this.step === "crashAfterDisplay") {
          model.alive = false;
          model.queued.clear();
        }

        break;
      }

      case "crash": {
        model.alive = false;
        model.queued.clear();
        break;
      }

      case "handover": {
        model.alive = true;
        model.generation += 1;
        model.queued = new Set(
          [...model.messages].flatMap(([id, message]) =>
            message.acknowledged ? [] : [id]
          )
        );
        break;
      }

      case "renew":
      case "resume": {
        break;
      }

      default: {
        break;
      }
    }

    await real.check(model);
  }
  toString() {
    return `${this.step}(${this.mode})`;
  }
}

const proof = (commands: readonly Command[], plant: Plant) =>
  Effect.gen(function* custodyProof() {
    const storage = yield* testStore;
    const store = yield* MailboxStore.pipe(Effect.provide(storage.layer));

    const leases = yield* LeaseAuthority.pipe(
      Effect.provide(leaseLayer.pipe(Layer.provide(storage.layer)))
    );

    const sample = yield* sealed();
    const now = yield* Clock.currentTimeMillis;
    const context = yield* Effect.context();

    const run = async <A>(effect: Effect.Effect<A, XrpcFailure>): Promise<A> =>
      // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- fast-check AsyncCommand requires a Promise; the owning property captures TestClock.
      await Effect.runPromiseWith(context)(effect);

    let holder: Lease.MainValue;
    let serial = 0;
    let lastId = "";
    let displayed: string[] = [];
    const observedDisplays = new Set<string>();
    const modes = new Map<string, typeof Mode.Type>();
    const queued = new Set<string>();

    const box = inbox({
      digest: (mails) => {
        displayed.push(
          ...shownIds({
            customType: DIGEST_MESSAGE,
            details: { ids: mails.map((mail) => mail.id) },
            role: "custom",
          })
        );
      },
      show: () => {},
    });

    const acquire = async (previous?: Lease.MainValue) => {
      serial += 1;

      const input = Schema.decodeUnknownSync(Acquire.Input)({
        did: recipientDid,
        expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + 300_000)),
        harness: {
          $type: "sh.mschf.ratking.runtime.lease#pi",
          sessionId: `holder-${serial}`,
        },
      });

      if (previous !== undefined) {
        Object.assign(input, {
          generation: previous.generation,
          leaseId: previous.leaseId,
        });
      }

      holder = await run(leases.acquire(input));
    };

    const take = async (message: Message) => {
      const id = message.envelope.aad.messageId;

      queued.add(id);
      box.take(
        { content: id, details: { id }, digestMinutes: 1, id },
        modes.get(id) ?? "steer"
      );
      await run(
        store.transaction((tx) => {
          validLease(tx, holder, now);
          deliverMessage(tx, message.envelope.aad.senderDid, id, now);

          if (plant === "earlyAck") {
            const current = tx.get(message.envelope.aad.senderDid, id);

            if (current) {
              transitionMessage(tx, current, "ack", now);
            }
          }
        })
      );
    };

    const replay = async (after: number) => {
      const events = await run(
        store.transaction((tx) => tx.events(after, tx.watermark(), 1000))
      );

      const ids = events
        .filter(Schema.is(Defs.MessageEvent))
        .map((event) => event.envelope.aad.messageId)
        .filter(
          (id) =>
            plant !== "suppressDisplayedReplay" || !observedDisplays.has(id)
        );

      const expected = await run(
        store.transaction((tx) =>
          tx.delivered().map((message) => message.envelope.aad.messageId)
        )
      );

      expect(
        ids,
        "redelivery is once per new generation, in sequence order"
      ).toEqual(expected);

      await Promise.all(
        ids.map(async (id) => {
          const message = await run(
            store.transaction((tx) => tx.get(sample.envelope.aad.senderDid, id))
          );

          if (message) {
            await take(message);
          }
        })
      );
    };

    const real: Real = {
      act: async (step, mode) => {
        displayed = [];

        switch (step) {
          case "receive": {
            serial += 1;
            lastId = tid(now + serial, 0);
            modes.set(lastId, mode);

            const envelope = Schema.decodeUnknownSync(
              Schema.toType(Defs.EncryptedEnvelope)
            )({
              ...sample.envelope,
              aad: { ...sample.envelope.aad, messageId: lastId },
            });

            const message = await run(
              store.transaction((tx) => {
                const seq = tx.watermark() + 1;

                const receipt = Schema.decodeUnknownSync(
                  Schema.toType(Defs.Receipt)
                )({
                  message: {
                    messageId: lastId,
                    senderDid: envelope.aad.senderDid,
                  },
                  recipientDid,
                  seq,
                  state: "accepted",
                });

                const saved = {
                  admission: receipt,
                  canonicalBytes: "fixture",
                  current: receipt,
                  envelope,
                };

                tx.put(saved);
                tx.append({
                  $type: "sh.mschf.ratking.defs#messageEvent",
                  envelope,
                  receipt,
                  seq,
                });

                return saved;
              })
            );

            await take(message);
            break;
          }

          case "show":
          case "crashAfterDisplay": {
            box.tick(0);
            box.tick(60_000);

            for (const id of queued) {
              if (modes.get(id) !== "digest") {
                displayed.push(
                  ...shownIds({
                    customType: MAIL_MESSAGE,
                    details: { id },
                    role: "custom",
                  })
                );
              }
            }

            await Promise.all(
              displayed.map(async (id) => {
                observedDisplays.add(id);
                box.shown(id);
                queued.delete(id);

                if (
                  step === "crashAfterDisplay" ||
                  (plant === "digestAck" && modes.get(id) === "digest")
                ) {
                  return;
                }

                await run(
                  store.transaction((tx) => {
                    validLease(tx, holder, now);
                    const message = tx.get(sample.envelope.aad.senderDid, id);

                    if (message && message.current.state !== "acked") {
                      transitionMessage(tx, message, "ack", now);
                    }
                  })
                );
              })
            );

            if (step === "crashAfterDisplay") {
              queued.clear();
              box.clear();
            }

            break;
          }

          case "crash": {
            queued.clear();
            box.clear();
            break;
          }

          case "handover": {
            const after = await run(store.transaction((tx) => tx.watermark()));

            queued.clear();
            box.clear();
            await acquire(holder);
            await replay(after);
            break;
          }

          case "renew": {
            const after = await run(store.transaction((tx) => tx.watermark()));

            holder = await run(
              leases.renew(
                Schema.decodeUnknownSync(Renew.Input)({
                  did: recipientDid,
                  expiresAt: DateTime.formatIso(
                    DateTime.makeUnsafe(now + 300_000)
                  ),
                  generation: holder.generation,
                  leaseId: holder.leaseId,
                })
              )
            );

            if (plant === "renewReplay") {
              await run(
                store.transaction((tx) => {
                  redeliver(tx, now);
                })
              );
            }

            expect(
              await run(store.transaction((tx) => tx.watermark())),
              "nothing is redelivered to the same generation"
            ).toBe(after);
            break;
          }

          case "resume": {
            const after = await run(store.transaction((tx) => tx.watermark()));
            const previous = holder;

            holder = await run(
              leases.acquire(
                Schema.decodeUnknownSync(Acquire.Input)({
                  did: recipientDid,
                  expiresAt: previous.expiresAt,
                  generation: previous.generation,
                  harness: Object.fromEntries(
                    Object.entries(previous.harness).toReversed()
                  ),
                  leaseId: previous.leaseId,
                })
              )
            );
            expect(holder).toEqual(previous);
            expect(await run(store.transaction((tx) => tx.watermark()))).toBe(
              after
            );
            break;
          }

          default: {
            break;
          }
        }
      },
      check: async (model) => {
        expect(holder.generation).toBe(model.generation);
        expect(queued).toEqual(model.queued);

        const open = await run(
          store.transaction((tx) =>
            tx.delivered().map((message) => message.envelope.aad.messageId)
          )
        );

        expect(
          new Set(open),
          "mailbox retains every unacknowledged message, and only unacknowledged messages"
        ).toEqual(
          new Set(
            [...model.messages].flatMap(([id, message]) =>
              message.acknowledged ? [] : [id]
            )
          )
        );
      },
      received: () => lastId,
      shown: () => displayed,
    };

    yield* Effect.promise(async () => {
      await acquire();

      const model: Model = {
        alive: true,
        generation: 1,
        messages: new Map(),
        queued: new Set(),
      };

      await fc.asyncModelRun(() => ({ model, real }), commands);

      if (plant === "none") {
        const [first] = model.messages.values();

        expect(
          first?.displayed,
          "two display-before-ack crashes allow one replay each, then successful ack stops repeats"
        ).toBe(3);
      }

      await new Command("handover", "steer").run(model, real);
      await new Command("show", "steer").run(model, real);
      expect(
        [...model.messages.values()].every(
          (message) => message.displayed > 0 && message.acknowledged
        ),
        "every received message is eventually displayed and acknowledged"
      ).toBe(true);
    });
  }).pipe(Effect.scoped);

it.effect.prop(
  "non-expiring custody survives display-before-ack crashes; successfully acknowledged never repeats",
  [
    Arbitrary.schema(
      Schema.Array(Schema.Struct({ mode: Mode, step: Step })).check(
        Schema.isMaxLength(35)
      )
    ),
  ],
  ([steps]) =>
    proof(
      [
        new Command("receive", "digest"),
        new Command("renew", "steer"),
        new Command("resume", "steer"),
        new Command("crashAfterDisplay", "steer"),
        new Command("handover", "steer"),
        new Command("renew", "steer"),
        new Command("resume", "steer"),
        new Command("crashAfterDisplay", "steer"),
        new Command("handover", "steer"),
        new Command("show", "steer"),
        new Command("handover", "steer"),
        ...steps.map(({ mode, step }) => new Command(step, mode)),
      ],
      "none"
    ),
  { arbitrary: { runs: 40 } }
);

it.effect.prop(
  "expiry and successful display ack both prevent redelivery to the next holder",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 2 }))
    ),
    Arbitrary.schema(Schema.Boolean),
  ],
  ([ttl, shown]) =>
    Effect.gen(function* expiryProof() {
      const storage = yield* testStore;
      const store = yield* MailboxStore.pipe(Effect.provide(storage.layer));

      const leases = yield* LeaseAuthority.pipe(
        Effect.provide(leaseLayer.pipe(Layer.provide(storage.layer)))
      );

      const sample = yield* sealed();
      const now = yield* Clock.currentTimeMillis;

      const envelope = yield* Schema.decodeUnknownEffect(
        Schema.toType(Defs.EncryptedEnvelope)
      )({
        ...sample.envelope,
        aad: {
          ...sample.envelope.aad,
          expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + ttl)),
        },
      });

      const receipt = yield* Schema.decodeUnknownEffect(
        Schema.toType(Defs.Receipt)
      )({
        message: {
          messageId: envelope.aad.messageId,
          senderDid: envelope.aad.senderDid,
        },
        recipientDid,
        seq: 1,
        state: "accepted",
      });

      const input = yield* Schema.decodeUnknownEffect(Acquire.Input)({
        did: recipientDid,
        expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + 300_000)),
        harness: {
          $type: "sh.mschf.ratking.runtime.lease#pi",
          sessionId: "first",
        },
      });

      const first = yield* leases.acquire(input);

      yield* store.transaction((tx) => {
        tx.put({
          admission: receipt,
          canonicalBytes: "fixture",
          current: receipt,
          envelope,
        });
        tx.append({
          $type: "sh.mschf.ratking.defs#messageEvent",
          envelope,
          receipt,
          seq: 1,
        });
        deliverMessage(tx, envelope.aad.senderDid, envelope.aad.messageId, now);

        if (shown) {
          const message = tx.get(
            envelope.aad.senderDid,
            envelope.aad.messageId
          );

          if (message) {
            transitionMessage(tx, message, "ack", now);
          }
        }
      });
      const after = yield* store.transaction((tx) => tx.watermark());

      yield* TestClock.adjust(ttl + 1);

      const next = yield* leases.acquire({
        ...input,
        generation: first.generation,
        harness: {
          $type: "sh.mschf.ratking.runtime.lease#pi",
          sessionId: "next",
        },
        leaseId: first.leaseId,
      });

      expect(next.generation).toBe(first.generation + 1);

      const replay = yield* store.transaction((tx) =>
        tx.events(after, tx.watermark(), 100)
      );

      expect(replay.filter(Schema.is(Defs.MessageEvent))).toEqual([]);
      const later = yield* Clock.currentTimeMillis;

      const final = yield* store.transaction((tx) =>
        deliverMessage(
          tx,
          envelope.aad.senderDid,
          envelope.aad.messageId,
          later
        )
      );

      expect(final.state).toBe(shown ? "acked" : "expired");
    }).pipe(Effect.scoped)
);

const plants: readonly Exclude<Plant, "none">[] = [
  "earlyAck",
  "renewReplay",
  "digestAck",
  "suppressDisplayedReplay",
];

for (const plant of plants) {
  it.effect(`custody proof rejects ${plant} on an assertion`, () =>
    proof(
      [
        new Command("receive", "digest"),
        new Command("renew", "steer"),
        new Command(
          plant === "suppressDisplayedReplay" ? "crashAfterDisplay" : "show",
          "steer"
        ),
        new Command("crash", "steer"),
        new Command("handover", "steer"),
      ],
      plant
    ).pipe(
      Effect.exit,
      Effect.tap((exit) =>
        Effect.sync(() => {
          expect(exit._tag).toBe("Failure");
          expect(String(exit)).toContain("AssertionError");
          expect(String(exit)).toContain(
            Match.value(plant).pipe(
              Match.when(
                "suppressDisplayedReplay",
                () => "redelivery is once per new generation, in sequence order"
              ),
              Match.when(
                "renewReplay",
                () => "nothing is redelivered to the same generation"
              ),
              Match.orElse(() => "mailbox retains every unacknowledged message")
            )
          );
        })
      )
    )
  );
}
