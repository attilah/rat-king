// @effect-diagnostics asyncFunction:off -- fast-check async commands drive the real issuer and mailbox services with their captured TestClock.
import { it } from "@effect/vitest";
import * as Defs from "@rat-king/lexicon/defs";
import * as ListRetired from "@rat-king/lexicon/identity.listRetired";
import * as Retire from "@rat-king/lexicon/identity.retireName";
import * as Unretire from "@rat-king/lexicon/identity.unretireName";
import { MailboxHandlers } from "@rat-king/lexicon/mailbox-handlers";
import * as Acquire from "@rat-king/lexicon/runtime.acquireLease";
import type * as RuntimeLease from "@rat-king/lexicon/runtime.lease";
import * as Release from "@rat-king/lexicon/runtime.releaseLease";
import type { Request as XrpcRequest } from "@rat-king/lexicon/transport";
import {
  Arbitrary,
  Clock,
  DateTime,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expect } from "vitest";

import { seal } from "../../../packages/envelope/src/envelope.ts";
import {
  payload,
  recipientDid,
  senderDid,
  testKeys,
} from "../../../packages/envelope/test/helpers.ts";
import { staticResolver } from "../src/auth.ts";
import { IssuerStore, issuerStore } from "../src/issuer-store.ts";
import {
  DocumentRegistry,
  issuerHandlers,
  issuerRoute,
} from "../src/issuer.ts";
import {
  Caller,
  handlersLayer,
  LeaseAuthority,
  leaseLayer,
} from "../src/mailbox.ts";
import { presenceOf } from "../src/retirement.ts";
import type { Presence } from "../src/retirement.ts";
import { MailboxStore } from "../src/store.ts";
import { tid } from "../src/tid.ts";
import { TestFailure } from "./celld.ts";
import {
  documents,
  storeRetirements,
  testStoreFor,
  unleasedSender,
} from "./helpers.ts";

const name = "proj/row";

const operator = "did:web:operator.example.invalid";

const host = "did:web:host.example.invalid";

const stranger = "did:web:stranger.example.invalid";

const callers = [operator, recipientDid, host, stranger];

const successors = [undefined, "proj/row-2"];

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

interface Model {
  now: number;
  retired?: { readonly successor?: string; readonly at: number };
  holder?: RuntimeLease.MainValue;
  lastHeldAt?: number;
}

interface Real {
  readonly issuer: (
    caller: string,
    request: XrpcRequest
  ) => Promise<{ readonly status: number; readonly body: string }>;
  readonly send: () => Promise<Result.Result<number, string>>;
  readonly acquire: (
    expiresAt: string
  ) => Promise<Result.Result<RuntimeLease.MainValue, string>>;
  readonly release: (lease: RuntimeLease.MainValue) => Promise<void>;
  readonly presence: () => Promise<ReturnType<typeof presenceOf>>;
  readonly watermark: () => Promise<number>;
  readonly setTime: (now: number) => Promise<void>;
}

const live = (model: Model) =>
  model.holder !== undefined && Date.parse(model.holder.expiresAt) > model.now;

const ErrorBody = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.String,
    message: Schema.optionalKey(Schema.String),
  })
);

const retiredLine = (model: Model) =>
  model.retired === undefined
    ? undefined
    : `${name} was retired at ${iso(model.retired.at)}; ${
        model.retired.successor === undefined
          ? "no successor"
          : `current row is ${model.retired.successor}`
      }`;

const expectedPresence = (model: Model): Presence => {
  if (live(model)) {
    return { held: true, lastHeldAt: model.now };
  }

  return model.lastHeldAt === undefined
    ? { held: false }
    : { held: false, lastHeldAt: model.lastHeldAt };
};

const checkModel = async (model: Model, real: Real) => {
  const before = await real.watermark();
  const sent = await real.send();
  const line = retiredLine(model);

  if (line === undefined) {
    expect(Result.isSuccess(sent)).toBe(true);
    expect(await real.watermark()).toBe(before + 1);
  } else {
    expect(sent).toEqual(Result.fail(`Retired: ${line}`));
    expect(await real.watermark()).toBe(before);
  }

  const listed = await real.issuer(stranger, {
    input: undefined,
    method: "GET",
    nsid: ListRetired.Method.nsid,
    params: {},
  });

  expect(listed.status).toBe(200);
  expect(
    Schema.decodeUnknownSync(Schema.fromJsonString(ListRetired.Output))(
      listed.body
    ).retired.map((entry) => [entry.name, entry.did, entry.successor])
  ).toEqual(
    model.retired === undefined
      ? []
      : [[name, recipientDid, model.retired.successor]]
  );

  expect(await real.presence()).toEqual(expectedPresence(model));
};

const Spec = Schema.Union([
  Schema.Struct({
    caller: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
    kind: Schema.Literal("retire"),
    successor: Schema.Int.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
  }),
  Schema.Struct({
    caller: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
    kind: Schema.Literal("unretire"),
  }),
  Schema.Struct({ kind: Schema.Literals(["acquire", "release"]) }),
  Schema.Struct({
    kind: Schema.Literal("advance"),
    millis: Schema.Int.check(
      Schema.isBetween({ maximum: 600_000, minimum: 1 })
    ),
  }),
]);

type SpecValue = typeof Spec.Type;

const command = (spec: SpecValue): fc.AsyncCommand<Model, Real> => ({
  check: () => true,
  run: async (model, real) => {
    switch (spec.kind) {
      case "retire": {
        const caller = callers[spec.caller] ?? stranger;
        const successor = successors[spec.successor];

        const response = await real.issuer(caller, {
          input: successor === undefined ? { name } : { name, successor },
          method: "POST",
          nsid: Retire.Method.nsid,
          params: undefined,
        });

        if (caller === stranger) {
          expect(Schema.decodeUnknownSync(ErrorBody)(response.body).error).toBe(
            "Forbidden"
          );
          break;
        }

        const output = Schema.decodeUnknownSync(
          Schema.fromJsonString(Retire.Output)
        )(response.body);

        expect([output.did, output.by, output.successor]).toEqual([
          recipientDid,
          caller,
          successor,
        ]);
        model.retired =
          successor === undefined
            ? { at: model.now }
            : { at: model.now, successor };
        break;
      }

      case "unretire": {
        const caller = callers[spec.caller] ?? stranger;

        const response = await real.issuer(caller, {
          input: { name },
          method: "POST",
          nsid: Unretire.Method.nsid,
          params: undefined,
        });

        if (caller === stranger) {
          expect(Schema.decodeUnknownSync(ErrorBody)(response.body).error).toBe(
            "Forbidden"
          );
          break;
        }

        expect(
          Schema.decodeUnknownSync(Schema.fromJsonString(Unretire.Output))(
            response.body
          ).cleared
        ).toBe(model.retired !== undefined);
        delete model.retired;
        break;
      }

      case "acquire": {
        const acquired = await real.acquire(iso(model.now + 60_000));

        if (live(model)) {
          expect(acquired).toEqual(Result.fail("LeaseHeld"));
          break;
        }

        expect(Result.isSuccess(acquired)).toBe(true);

        if (Result.isSuccess(acquired)) {
          model.holder = acquired.success;
        }

        delete model.retired;
        break;
      }

      case "release": {
        if (model.holder !== undefined && live(model)) {
          await real.release(model.holder);
          model.lastHeldAt = model.now;
          delete model.holder;
        }

        break;
      }

      case "advance": {
        const next = model.now + spec.millis;

        if (model.holder !== undefined && live(model)) {
          const expiresAt = Date.parse(model.holder.expiresAt);

          if (expiresAt <= next) {
            model.lastHeldAt = expiresAt;
          }
        }

        await real.setTime(next);
        model.now = next;
        break;
      }

      default: {
        const exhaustive: never = spec;

        throw new Error(String(exhaustive));
      }
    }

    await checkModel(model, real);
  },
  toString: () => JSON.stringify(spec),
});

it.effect.prop(
  "a retired name refuses admission naming its successor until its own lease acquisition or an authorized unretire clears it, and presence follows the lease",
  [Arbitrary.array(Arbitrary.schema(Spec), { maxLength: 25 })],
  ([specs]) =>
    Effect.gen(function* lifecycle() {
      const keys = yield* testKeys();

      const docs = yield* documents(
        keys.sender.publicKey,
        keys.recipient.publicKey
      );

      const recipientDocument = docs.find((doc) => doc.id === recipientDid);

      const issuerStorage = yield* testStoreFor(
        "did:web:issuer.example.invalid"
      );

      const mailboxStorage = yield* testStoreFor(recipientDid);

      const store = yield* MailboxStore.pipe(
        Effect.provide(mailboxStorage.layer)
      );

      if (recipientDocument !== undefined) {
        const decoded = yield* Schema.decodeUnknownEffect(Defs.DidDocument)(
          recipientDocument
        );

        yield* store.transaction((tx) => {
          tx.setDocument(decoded);
        });
      }

      const issuerLayer = issuerStore(issuerStorage.sql);

      yield* Effect.gen(function* seed() {
        const issuer = yield* IssuerStore;

        if (recipientDocument !== undefined) {
          yield* issuer.transaction((tx) => {
            tx.bind(
              name,
              { did: recipientDid, fingerprint: "seed", host },
              recipientDocument
            );
          });
        }
      }).pipe(Effect.provide(issuerLayer));

      const leases = yield* LeaseAuthority.pipe(
        Effect.provide(leaseLayer.pipe(Layer.provide(mailboxStorage.layer)))
      );

      const handlers = yield* MailboxHandlers.pipe(
        Effect.provide(
          handlersLayer.pipe(
            Layer.provide(mailboxStorage.layer),
            Layer.provide(staticResolver(docs)),
            Layer.provide(Layer.succeed(Caller, { did: senderDid })),
            Layer.provide(unleasedSender)
          )
        )
      );

      const unusedDocuments = Layer.succeed(
        DocumentRegistry,
        DocumentRegistry.of({
          put: () =>
            Effect.die(
              new TestFailure({ message: "Unused document registry" })
            ),
        })
      );

      const context = yield* Effect.context();

      const run = async <A, E>(effect: Effect.Effect<A, E>) =>
        // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- fast-check AsyncCommand requires a Promise; the owning property uses it.effect and this captured TestClock.
        await Effect.runPromiseWith(context)(effect);

      let counter = 0;

      const real: Real = {
        acquire: async (expiresAt) =>
          await run(
            leases
              .acquire(
                Schema.decodeUnknownSync(Acquire.Input)({
                  did: recipientDid,
                  expiresAt,
                  harness: {
                    $type: "sh.mschf.ratking.runtime.lease#pi",
                    sessionId: "model",
                  },
                })
              )
              .pipe(
                Effect.mapError((error) => error.error),
                Effect.result
              )
          ),
        issuer: async (caller, request) =>
          await run(
            issuerRoute(request).pipe(
              Effect.provide(
                issuerHandlers({
                  config: Option.some({
                    didTemplate: "did:web:{agent}.pi.example.invalid",
                    reserved: [],
                  }),
                  operators: [operator],
                }).pipe(
                  Layer.provide(issuerLayer),
                  Layer.provide(unusedDocuments),
                  Layer.provide(storeRetirements(() => Effect.succeed(store))),
                  Layer.provide(Layer.succeed(Caller, { did: caller }))
                )
              )
            )
          ),
        presence: async () =>
          await run(
            Effect.gen(function* presence() {
              const now = yield* Clock.currentTimeMillis;

              return yield* store.transaction((tx) =>
                presenceOf(tx.lease(), now)
              );
            })
          ),
        release: async (lease) => {
          await run(
            leases.release(
              Schema.decodeUnknownSync(Release.Input)({
                did: recipientDid,
                generation: lease.generation,
                leaseId: lease.leaseId,
              })
            )
          );
        },
        send: async () => {
          counter += 1;

          return await run(
            Effect.gen(function* sendOne() {
              const now = yield* Clock.currentTimeMillis;

              const envelope = yield* seal({
                payload: payload(tid(now, counter)),
                recipientKey: keys.recipient.publicKey,
                recipientKeyId: `${recipientDid}#encryption`,
                signingKey: keys.sender.privateKey,
                signingKeyId: `${senderDid}#atproto`,
              });

              return yield* handlers.send({ envelope }).pipe(
                Effect.map(({ receipt }) => receipt.seq),
                Effect.mapError(
                  (error) => `${error.error}: ${error.message ?? ""}`
                ),
                Effect.result
              );
            }).pipe(Effect.orDie)
          );
        },
        setTime: async (now) => {
          await run(TestClock.setTime(now));
        },
        watermark: async () =>
          await run(store.transaction((tx) => tx.watermark())),
      };

      const required: SpecValue[] = [
        { caller: 0, kind: "retire", successor: 1 },
        { kind: "acquire" },
      ];

      const model: Model = { now: yield* Clock.currentTimeMillis };

      yield* Effect.promise(async () => {
        await fc.asyncModelRun(
          () => ({ model, real }),
          [...required, ...specs].map(command)
        );
      });
    }).pipe(Effect.scoped)
);
