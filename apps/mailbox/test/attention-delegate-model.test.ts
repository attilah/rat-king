import { it } from "@effect/vitest";
import { sign } from "@rat-king/envelope/es256";
import * as PutStatus from "@rat-king/lexicon/attention.putStatus";
import * as Status from "@rat-king/lexicon/attention.status";
import {
  Arbitrary,
  Effect,
  Layer,
  Match,
  Option,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expect } from "vitest";

import {
  recipientDid,
  sealed,
  senderDid,
} from "../../../packages/envelope/test/helpers.ts";
import {
  attentionBytes,
  defaultStatus,
} from "../../../packages/mailbox-client/src/attention.ts";
import { AttentionDirectory } from "../src/attention-directory.ts";
import { attentionHandlers } from "../src/attention.ts";
import { staticResolver } from "../src/auth.ts";
import { Caller } from "../src/caller.ts";
import { MailboxStore } from "../src/store.ts";
import { TestFailure } from "./celld.ts";
import { documents, testStore } from "./helpers.ts";

const Case = Schema.Literals([
  "self",
  "unknown",
  "cycle",
  "expired",
  "available",
  "valid",
]);

const PeerState = Schema.Literals(["available", "busy", "dnd"]);

interface Real {
  readonly run: (effect: Effect.Effect<void, unknown>) => Promise<void>;
}

interface Model {
  seq: number;
  status: Status.MainValue;
}

it.effect.prop(
  "delegate writes reject self, unknown and active cycles without a receipt; valid and lapsed cycles round-trip",
  [
    Arbitrary.schema(Schema.Array(Case).check(Schema.isMaxLength(12))),
    Arbitrary.schema(PeerState),
  ],
  ([random, state]) =>
    Effect.gen(function* proof() {
      yield* TestClock.setTime(1000);
      const sample = yield* sealed();

      const docs = yield* documents(
        sample.keys.sender.publicKey,
        sample.keys.recipient.publicKey
      );

      const storage = yield* testStore;
      const store = yield* MailboxStore.pipe(Effect.provide(storage.layer));
      let current: typeof Case.Type = "valid";

      const owner = yield* attentionHandlers.pipe(
        Effect.provide(
          Layer.mergeAll(
            storage.layer,
            staticResolver(docs),
            Layer.succeed(Caller, { did: recipientDid }),
            Layer.succeed(AttentionDirectory, {
              resolve: (name) =>
                Effect.succeed(
                  Match.value(name).pipe(
                    Match.when("alpha/desk", () => Option.some(recipientDid)),
                    Match.when("alpha/ea", () => Option.some(senderDid)),
                    Match.orElse(() => Option.none<string>())
                  )
                ),
              status: () =>
                Effect.succeed(
                  Schema.decodeUnknownSync(Status.Main)({
                    ...defaultStatus(),
                    delegate:
                      current === "valid" ? "alpha/other" : "alpha/desk",
                    state: current === "available" ? "available" : state,
                    until:
                      current === "expired"
                        ? "1970-01-01T00:00:01.000Z"
                        : "1970-01-01T00:00:01.001Z",
                  })
                ),
            })
          )
        )
      );

      const model: Model = { seq: 0, status: defaultStatus() };
      const context = yield* Effect.context();
      const real: Real = { run: Effect.runPromise };

      const command = (
        value: typeof Case.Type
      ): fc.AsyncCommand<Model, typeof real> => ({
        check: () => true,
        run: real.run.bind(
          undefined,
          Effect.gen(function* write() {
            current = value;

            const delegate = Match.value(value).pipe(
              Match.when("self", () => "alpha/desk"),
              Match.when("unknown", () => "alpha/missing"),
              Match.orElse(() => "alpha/ea")
            );

            const status = yield* Schema.decodeUnknownEffect(Status.Main)({
              ...defaultStatus(),
              delegate,
              exempt: ["alpha/alarm"],
              state: "busy",
            });

            const input = yield* Schema.decodeUnknownEffect(
              Schema.toType(PutStatus.Input)
            )({
              did: recipientDid,
              keyId: `${recipientDid}#atproto`,
              signature: yield* sign(
                sample.keys.sender.privateKey,
                attentionBytes(recipientDid, PutStatus.Method.nsid, status)
              ),
              status,
            });

            const result = yield* owner.putStatus(input).pipe(Effect.result);

            const error = Match.value(value).pipe(
              Match.when("self", () => "DelegateSelf"),
              Match.when("unknown", () => "DelegateNotFound"),
              Match.when("cycle", () =>
                state === "available" ? undefined : "DelegateCycle"
              ),
              Match.orElse(() => {})
            );

            expect(Result.isSuccess(result)).toBe(error === undefined);

            if (Result.isFailure(result)) {
              expect(result.failure.error).toBe(error);
            } else {
              model.seq += 1;
              model.status = status;
              expect(result.success.status).toEqual(status);
            }

            const observed = yield* store.transaction((tx) => ({
              seq: tx.watermark(),
              status: tx.attentionStatus() ?? defaultStatus(),
            }));

            expect(observed).toEqual(model);
          }).pipe(Effect.provide(context))
        ),
        toString: () => value,
      });

      const values: readonly (typeof Case.Type)[] = [
        "self",
        "unknown",
        "cycle",
        "expired",
        "available",
        "valid",
        ...random,
      ];

      yield* Effect.tryPromise({
        catch: (cause) => new TestFailure({ message: String(cause) }),
        try: fc.asyncModelRun.bind(
          undefined,
          () => ({ model, real }),
          values.map(command)
        ),
      });
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 12 }, timeout: 30_000 }
);
