// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off -- fast-check models execute Effect at the test boundary.
/* oxlint-disable typescript/promise-function-async -- asyncModelRun is a Promise-based test adapter. */
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import {
  BillingRelay,
  relayAlert,
  RelayFailure,
} from "../../stacks/nest/billing-relay.ts";
import type { JournalEntryValue } from "../../stacks/nest/billing-relay.ts";
import type { Sealed } from "../../stacks/nest/seal.ts";

const generatedAlert = Arbitrary.schema(
  Schema.Struct({
    payload: Schema.Json,
    receivedAt: Schema.Finite,
    seed: Schema.Int,
  })
).pipe(
  Arbitrary.map(({ seed, ...alert }) => ({
    ...alert,
    id: Math.abs(seed).toString(16).padStart(64, "0"),
  }))
);

const generatedSealed = Arbitrary.schema(Schema.String).pipe(
  Arbitrary.map((data): typeof Sealed.Type => ({
    envelope: {
      aad: {
        messageId: "2222222222222",
        recipientDid: "did:web:recipient.example.invalid",
        recipientKeyId: "did:web:recipient.example.invalid#encryption",
        senderDid: "did:web:sender.example.invalid",
      },
      ciphertext: {
        $bytes: btoa(
          String.fromCodePoint(
            ...new TextEncoder().encode(data || "generated-empty")
          )
        ),
      },
      enc: { $bytes: "AQ==" },
      suite: { aeadId: 1, kdfId: 1, kemId: 16 },
      version: 1,
    },
    messageId: "2222222222222",
    to: "switchboard",
  }))
);

const Steps = Schema.Array(
  Schema.Literals([
    "success",
    "refused",
    "uncertain",
    "lost",
    "save-crash",
    "ack-crash",
  ])
).check(Schema.isMinLength(5), Schema.isMaxLength(30));

it.effect.prop(
  "models retry and both crash windows without duplicate delivery or failed-send ack",
  {
    alert: generatedAlert,
    sealed: generatedSealed,
    steps: Arbitrary.schema(Steps),
  },
  ({ steps, alert, sealed }) =>
    Effect.gen(function* modelTest() {
      let journal: JournalEntryValue | undefined;
      let seals = 0;
      let acks = 0;
      const admitted = new Set<string>();
      const outer = yield* Effect.context();

      interface Model {
        delivered: boolean;
        sent: boolean;
      }

      const commands: AsyncCommand<Model, object>[] = steps.map((step) => ({
        check: () => true,
        run: async (model) => {
          const beforeAcks = acks;
          const wasSent = model.sent;

          const relay = BillingRelay.of({
            ack: () => {
              if (step === "ack-crash") {
                return Effect.fail(
                  new RelayFailure({ operation: "simulated-ack-crash" })
                );
              }

              acks += 1;

              return Effect.void;
            },
            load: () => Effect.succeed(journal),
            refused: () => Effect.void,
            save: (entry) => {
              if (entry.sent && step === "save-crash") {
                return Effect.fail(
                  new RelayFailure({ operation: "simulated-save-crash" })
                );
              }

              journal = entry;

              return Effect.void;
            },
            seal: () => {
              seals += 1;

              return Effect.succeed(sealed);
            },
            send: (value) => {
              expect(value).toEqual(sealed);

              if (step === "refused") {
                return Effect.succeed(2);
              }

              if (step === "uncertain") {
                return Effect.succeed(3);
              }

              admitted.add(JSON.stringify(value.envelope));

              return Effect.succeed(step === "lost" ? 3 : 0);
            },
          });

          // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- asyncModelRun requires a Promise command.
          await Effect.runPromiseWith(outer)(
            relayAlert(alert).pipe(
              Effect.provideService(BillingRelay, relay),
              Effect.result
            )
          );

          if (!wasSent) {
            if (!["refused", "uncertain"].includes(step)) {
              model.delivered = true;
            }

            if (
              !["refused", "uncertain", "lost", "save-crash"].includes(step)
            ) {
              model.sent = true;
            }
          }

          expect(admitted.size).toBe(model.delivered ? 1 : 0);
          expect(seals).toBe(1);
          expect(journal?.sent).toBe(model.sent);
          expect(acks - beforeAcks).toBe(
            model.sent && step !== "ack-crash" ? 1 : 0
          );
        },
        toString: () => step,
      }));

      yield* Effect.promise(() =>
        asyncModelRun(
          () => ({ model: { delivered: false, sent: false }, real: {} }),
          commands
        )
      );
    })
);
