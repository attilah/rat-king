// @effect-diagnostics nodeBuiltinImport:off -- Generated header tokens use Node's offline encoding adapter.
/* oxlint-disable typescript/promise-function-async -- Fake bindings return resolved platform Promises. */
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Match, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { expect } from "vitest";

import { bindingServices } from "./bindings.ts";
import { BODY_LIMIT } from "./contracts.ts";
import { handle } from "./http.ts";

const scenarios = {
  ack: { method: "POST", path: "/ack", status: 200 },
  "ack-denied": { method: "POST", path: "/ack", status: 401 },
  invalid: { method: "POST", path: "/", status: 400 },
  method: { method: "GET", path: "/", status: 405 },
  missing: { method: "POST", path: "/", status: 401 },
  ok: { method: "POST", path: "/", status: 200 },
  oversize: { method: "POST", path: "/", status: 413 },
  pull: { method: "GET", path: "/pull", status: 200 },
  "pull-denied": { method: "GET", path: "/pull", status: 401 },
  rate: { method: "POST", path: "/", status: 429 },
  unknown: { method: "POST", path: "/other", status: 404 },
  wrong: { method: "POST", path: "/", status: 401 },
};

const Input = Schema.Struct({
  mode: Schema.Literals([
    "ok",
    "missing",
    "wrong",
    "rate",
    "oversize",
    "invalid",
    "method",
    "unknown",
    "pull",
    "ack",
    "pull-denied",
    "ack-denied",
  ]),
  payload: Schema.Json,
  secret: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});

it.effect.prop(
  "gates the actual binding adapter before obtaining any DO stub",
  { input: Arbitrary.schema(Input) },
  ({ input }) =>
    Effect.gen(function* test() {
      let stubCalls = 0;
      let limitCalls = 0;
      const queued: unknown[] = [];
      const acked: unknown[] = [];

      const secret = [...new TextEncoder().encode(input.secret)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      const services = bindingServices({
        ALERTS: {
          getByName: () => {
            stubCalls += 1;

            return {
              ack: (ids) => {
                acked.push(ids);

                return Promise.resolve();
              },
              insert: (alert) => {
                queued.push(alert);

                return Promise.resolve();
              },
              pull: () => Promise.resolve([]),
            };
          },
        },
        BILLING_PULL_CREDENTIAL: `${secret}-pull`,
        BILLING_WEBHOOK_CREDENTIAL: secret,
        RATE_LIMIT: {
          limit: () => {
            limitCalls += 1;

            return Promise.resolve({ success: input.mode !== "rate" });
          },
        },
      });

      const scenario = scenarios[input.mode];
      const headers: Record<string, string> = {};

      if (input.mode !== "missing") {
        headers["cf-webhook-auth"] =
          input.mode === "wrong" ? `${secret}-wrong` : secret;
      }

      if (input.mode === "pull" || input.mode === "ack") {
        headers.authorization = `Bearer ${secret}-pull`;
      }

      const body = Match.value(input.mode).pipe(
        Match.when("oversize", () => "x".repeat(BODY_LIMIT + 1)),
        Match.when("invalid", () => "{"),
        Match.whenOr("ack", "ack-denied", () => JSON.stringify({ ids: [] })),
        Match.orElse(() => JSON.stringify(input.payload))
      );

      const options: RequestInit = { headers, method: scenario.method };

      if (scenario.method === "POST") {
        options.body = body;
      }

      const request = new Request(
        `https://billing.example.invalid${scenario.path}`,
        options
      );

      const response = yield* handle(HttpServerRequest.fromWeb(request)).pipe(
        Effect.provide(services)
      );

      expect(response.status).toBe(scenario.status);
      expect(stubCalls).toBe(scenario.status === 200 ? 1 : 0);
      expect(queued).toHaveLength(input.mode === "ok" ? 1 : 0);
      expect(acked).toHaveLength(input.mode === "ack" ? 1 : 0);
      expect(limitCalls).toBe(
        ["ok", "rate", "oversize", "invalid"].includes(input.mode) ? 1 : 0
      );
    })
);
