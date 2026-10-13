import { Effect, Schema } from "effect";

export const AgentName = Schema.String.check(
  Schema.isPattern(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z][a-z0-9_-]{0,31}$/u)
);

export const SUMMARY_MAX = 280;

export const SUMMARY_HARD_MAX = 400;

export const SUMMARY_WIRE_MAX = SUMMARY_MAX;

export const Kind = Schema.Literals(["message", "ask", "reply", "data"]);

export type KindValue = typeof Kind.Type;

export const Payload = Schema.Struct({
  body: Schema.String,
  cc: Schema.optionalKey(Schema.Array(AgentName)),
  from: AgentName,
  kind: Schema.optionalKey(Kind),
  label: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
  replyTo: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(SUMMARY_HARD_MAX))
  ),
  thread: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(AgentName),
});

export type PayloadValue = typeof Payload.Type;

export const PayloadJson = Schema.fromJsonString(Payload);

export const encodePayload = Effect.fn("RatKing.encodePayload")(
  function* encodePayload(payload: PayloadValue) {
    return yield* Schema.encodeEffect(PayloadJson)(payload);
  }
);
