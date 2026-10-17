import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.ratking.invite"),
    allowFleetOutbound: Schema.Boolean,
    createdAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    expiresAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    issuer: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
    namespace: Runtime.lexString({
      maxLength: 128,
      minLength: 5,
      type: "string",
    }).check(Schema.isPattern(/^ext\/[a-z0-9][a-z0-9_-]*\/$/u)),
    ratePerMinute: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(120)
    ),
    recipients: Schema.Array(
      Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" })
    ).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
    subject: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
    subjectKey: Runtime.lexString({
      maxLength: 64,
      minLength: 64,
      type: "string",
    }).check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.ratking.invite",
  key: "tid",
} as const;
