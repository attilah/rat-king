/* oxlint-disable typescript/promise-function-async -- fast-check commands bridge into the existing Effect test context. */
import { it } from "@effect/vitest";
import { TrustResult } from "@rat-king/lexicon/trust";
import type { Signatures, TrustAuthority } from "@rat-king/lexicon/trust";
import { signatures } from "@rat-king/lexicon/webcrypto";
import { Arbitrary, Effect, Layer, Option, Ref, Schema } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";
import { TestClock } from "effect/testing";
import { asyncModelRun } from "fast-check";
import type { AsyncCommand } from "fast-check";
import { expect } from "vitest";

import {
  credential,
  fixture,
  now,
} from "../../../packages/lexicon/test/trust-helpers.ts";
import { authorityFrom } from "../src/authority.ts";
import { contactDispatcher } from "../src/contact-handler.ts";
import type { StoredSessionValue } from "../src/session.ts";
import { externalId, legacyRequest, rpcReply } from "./http-helpers.ts";

const History = Schema.Struct({
  steps: Schema.Array(
    Schema.Literals(["initialize", "call", "reconnect", "self-keyed", "delete"])
  ).check(Schema.isMaxLength(20)),
  version: Schema.Literals([
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
  ]),
});

interface Model {
  phase: "unopened" | "active" | "closed";
  tier: number;
}

const IdentityReply = Schema.Struct({
  result: Schema.Struct({
    content: Schema.NonEmptyArray(
      Schema.Struct({ text: Schema.String, type: Schema.Literal("text") })
    ),
  }),
});

it.effect.prop(
  "legacy sessions preserve initialization across reconnects without retaining credential authority",
  [Arbitrary.schema(History)],
  ([history]) =>
    Effect.gen(function* sessionModel() {
      yield* TestClock.setTime(now);
      const sample = yield* fixture;
      const token = `Bearer ${Base64Url.encode(JSON.stringify(credential(sample, false)))}`;

      const stored = yield* Ref.make<Option.Option<StoredSessionValue>>(
        Option.none()
      );

      const dispatch = yield* contactDispatcher("lobby", {
        load: Ref.get(stored).pipe(Effect.map(Option.getOrUndefined)),
        save: (value) => Ref.set(stored, Option.some(value)),
      });

      const context = yield* Effect.context<Signatures | TrustAuthority>();

      const steps: typeof history.steps = [
        "call",
        "initialize",
        "self-keyed",
        "reconnect",
        ...history.steps,
        "delete",
        "initialize",
        "call",
      ];

      const command = (
        step: (typeof history.steps)[number]
      ): AsyncCommand<Model, object> => ({
        check: () => true,
        run: (model) => {
          const operation = Effect.gen(function* contactCommand() {
            const method = step === "initialize" ? "initialize" : "tools/call";
            const source = legacyRequest(method, history.version);
            const body = yield* Effect.promise(source.text.bind(source));
            const headers = new Headers(source.headers);

            if (step === "self-keyed") {
              headers.set("authorization", token);
            }

            const request = new Request(source.url, {
              body: step === "delete" ? null : body,
              headers,
              method: step === "delete" ? "DELETE" : "POST",
            });

            const result = yield* dispatch(request, body, externalId);

            let expected = model.phase === "active" ? 200 : 404;

            if (step === "initialize") {
              expected = { active: 409, closed: 404, unopened: 200 }[
                model.phase
              ];

              if (model.phase === "unopened") {
                model.phase = "active";
                model.tier = 0;
              }
            } else if (step === "delete" && model.phase === "active") {
              expected = 204;
              model.phase = "closed";
              model.tier = 0;
            } else if (model.phase === "active") {
              model.tier = step === "self-keyed" ? 1 : 0;
            }

            if (result.status !== expected) {
              const detail = yield* Effect.promise(result.text.bind(result));
              expect(result.status, `${step}: ${detail}`).toBe(expected);
            }

            if (expected === 200) {
              expect(result.headers.get("mcp-session-id")).toBe(externalId);

              if (step === "initialize") {
                yield* Effect.promise(result.text.bind(result));
              } else {
                const actual = yield* Schema.decodeUnknownEffect(IdentityReply)(
                  yield* rpcReply(result)
                );

                const identity = yield* Schema.decodeUnknownEffect(
                  Schema.fromJsonString(TrustResult)
                )(actual.result.content[0].text);

                expect(identity.tier).toBe(model.tier);
              }
            }

            const persisted = Option.getOrUndefined(yield* Ref.get(stored));
            expect(persisted?.phase ?? "unopened").toBe(model.phase);

            if (persisted !== undefined) {
              expect(persisted.policy.tier).toBe(model.tier);
              expect(persisted.policy.mailEnabled).toBe(false);
              expect(JSON.stringify(persisted)).not.toContain(token);
            }
          });

          // oxlint-disable-next-line effect-tests/no-manual-effect-runtime-in-tests -- asyncModelRun requires a Promise per command; this reuses the scoped Effect test services.
          return Effect.runPromiseWith(context)(operation);
        },
        toString: () => step,
      });

      const initialModel: Model = { phase: "unopened", tier: 0 };

      yield* Effect.promise(() =>
        asyncModelRun(
          () => ({ model: initialModel, real: {} }),
          steps.map(command)
        )
      );
    }).pipe(Effect.provide(Layer.merge(signatures, authorityFrom()))),
  { arbitrary: { runs: 8 } }
);
