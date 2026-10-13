/* oxlint-disable typescript/promise-function-async, effect-tests/no-manual-effect-runtime-in-tests -- fast-check commands bridge the owning Effect test context. */
import { it } from "@effect/vitest";
import { AskJournal, openAsks } from "@rat-king/ratking-client/asks";
import type { AsksApi, PendingAskValue } from "@rat-king/ratking-client/asks";
import type { Inbound } from "@rat-king/ratking-client/payload";
import { Effect, Option, Schema } from "effect";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

const Step = Schema.Literals([
  "ask",
  "reply",
  "wrongSender",
  "ack",
  "restart",
  "clock",
]);

interface Model {
  answered: boolean;
  dueBy: number;
  now: number;
  nudged: boolean;
  open: boolean;
}

interface Real {
  journal: AsksApi<never>;
}

const reply: Inbound = {
  body: "answer",
  cc: false,
  did: "did:web:peer.invalid",
  from: "peer",
  id: "reply",
  kind: "reply",
  label: Option.none(),
  replyTo: Option.some("ask"),
  summary: Option.none(),
  verified: true,
};

it.effect.prop(
  "pending asks model: restart preserves custody, one nudge, strict sender and late replies",
  [Schema.Array(Step).check(Schema.isMaxLength(40)), Schema.Boolean],
  ([steps, deadline]) =>
    Effect.gen(function* modelProof() {
      let saved = "[]";
      let now = 0;
      const context = yield* Effect.context();

      const restart = openAsks({
        load: Effect.suspend(() =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(AskJournal))(saved)
        ).pipe(Effect.orDie),
        now: Effect.sync(() => now),
        save: (entries) =>
          Schema.encodeEffect(Schema.fromJsonString(AskJournal))(entries).pipe(
            Effect.orDie,
            Effect.tap((json) =>
              Effect.sync(() => {
                saved = json;
              })
            ),
            Effect.asVoid
          ),
      });

      const real: Real = { journal: yield* restart };

      const perform = (step: typeof Step.Type, model: Model, actual: Real) =>
        Effect.gen(function* command() {
          if (step === "ask") {
            const ask: PendingAskValue = {
              did: reply.did,
              id: "ask",
              sentAt: model.now,
              state: "pending",
              summary: "question",
              to: "peer",
            };

            model.dueBy = deadline ? model.now + 1 : Infinity;

            if (deadline) {
              Object.assign(ask, { dueBy: model.dueBy });
            }

            yield* actual.journal.record(ask);
            model.open = true;
            model.answered = false;
            model.nudged = false;
          }

          if (step === "clock") {
            model.now += 2;
            now += 2;
          }

          if (step === "restart") {
            actual.journal = yield* restart;
          }

          if (step === "ack") {
            yield* actual.journal.ack("ask");
            model.open = false;
          }

          if (step === "reply" || step === "wrongSender") {
            const found = yield* actual.journal.match(
              step === "reply"
                ? reply
                : { ...reply, did: "did:web:other.invalid" }
            );

            expect(Option.isSome(found)).toBe(model.open && step === "reply");

            if (model.open && step === "reply") {
              model.answered = true;
            }
          }
        });

      const verify = (model: Model, actual: Real) =>
        Effect.gen(function* verifyModel() {
          const nudges = yield* actual.journal.nudges;

          const expected =
            deadline &&
            model.open &&
            !model.nudged &&
            !model.answered &&
            model.now >= model.dueBy;

          expect(nudges).toHaveLength(expected ? 1 : 0);

          if (expected) {
            model.nudged = true;
          }

          expect(yield* actual.journal.pending).toHaveLength(
            model.open ? 1 : 0
          );
        });

      const sequence: (typeof Step.Type)[] = [
        "ask",
        "restart",
        "clock",
        "restart",
        "clock",
        "wrongSender",
        "reply",
        "restart",
        "ack",
        ...steps,
      ];

      const commands: AsyncCommand<Model, Real>[] = sequence.map((step) => ({
        check: (model) => (step === "ask" ? !model.open : true),
        run: (model, actual) =>
          Effect.runPromiseWith(context)(
            perform(step, model, actual).pipe(
              Effect.andThen(verify(model, actual))
            )
          ),
        toString: () => step,
      }));

      yield* Effect.promise(() =>
        asyncModelRun(
          () => ({
            model: {
              answered: false,
              dueBy: Infinity,
              now: 0,
              nudged: false,
              open: false,
            },
            real,
          }),
          commands
        )
      );
    })
);
