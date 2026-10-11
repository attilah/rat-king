import { Predicate, Schema } from "effect";

export const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

export const BODY_LIMIT = 64 * 1024;

export const RETENTION = 7 * 24 * 60 * 60 * 1000;

export const BATCH_LIMIT = 20;

export const AlertId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));

export const Alert = Schema.Struct({
  id: AlertId,
  payload: Schema.Json,
  receivedAt: Schema.Finite,
});

export type AlertValue = typeof Alert.Type;

export const Alerts = Schema.Array(Alert).check(
  Schema.isMaxLength(BATCH_LIMIT)
);

export const Ack = Schema.Struct({
  ids: Schema.Array(AlertId).check(Schema.isMaxLength(BATCH_LIMIT)),
});

export { BillingFailure } from "./failure.ts";

export { AlertQueue } from "./queue-service.ts";

export { IngressAuth } from "./auth-service.ts";
