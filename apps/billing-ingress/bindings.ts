import { Effect, Layer, Schema } from "effect";

import { secretMatches } from "./auth.ts";
/* oxlint-disable typescript/promise-function-async -- Durable Object and rate-limit bindings are Promise-based. */
import type { AlertValue } from "./contracts.ts";
import {
  AlertQueue,
  Alerts,
  BillingFailure,
  IngressAuth,
} from "./contracts.ts";

export interface BillingBindings {
  readonly BILLING_WEBHOOK_CREDENTIAL: string;
  readonly BILLING_PULL_CREDENTIAL: string;
  readonly ALERTS: {
    readonly getByName: (name: string) => {
      readonly insert: (value: AlertValue) => Promise<void>;
      readonly pull: () => Promise<readonly AlertValue[]>;
      readonly ack: (value: readonly string[]) => Promise<void>;
    };
  };
  readonly RATE_LIMIT: {
    readonly limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
}

const unavailable = () => new BillingFailure({ status: 503 });

export const bindingServices = (env: BillingBindings) =>
  Layer.merge(
    Layer.succeed(IngressAuth, {
      limit: () =>
        Effect.tryPromise({
          catch: unavailable,
          try: () => env.RATE_LIMIT.limit({ key: "billing-ingress" }),
        }).pipe(Effect.map(({ success }) => success)),
      pull: (value) =>
        secretMatches(`Bearer ${env.BILLING_PULL_CREDENTIAL}`, value).pipe(
          Effect.map((same) => env.BILLING_PULL_CREDENTIAL.length > 0 && same)
        ),
      webhook: (value) => secretMatches(env.BILLING_WEBHOOK_CREDENTIAL, value),
    }),
    Layer.succeed(AlertQueue, {
      ack: (ids) =>
        Effect.tryPromise({
          catch: unavailable,
          try: () => env.ALERTS.getByName("billing").ack([...ids]),
        }).pipe(Effect.asVoid),
      insert: (alert) =>
        Effect.tryPromise({
          catch: unavailable,
          try: () => env.ALERTS.getByName("billing").insert(alert),
        }).pipe(Effect.asVoid),
      pull: () =>
        Effect.tryPromise({
          catch: unavailable,
          try: () => env.ALERTS.getByName("billing").pull(),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Alerts)),
          Effect.mapError(unavailable)
        ),
    })
  );
