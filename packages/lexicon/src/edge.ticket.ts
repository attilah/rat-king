import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.ratking.ticket"),
    did: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
    exp: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
    fingerprint: Runtime.lexString({
      maxLength: 64,
      minLength: 64,
      type: "string",
    }).check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
    iat: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
    issuer: Runtime.lexString({ maxLength: 512, minLength: 1, type: "string" }),
    name: Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }),
    namespace: Runtime.lexString({
      maxLength: 256,
      minLength: 1,
      type: "string",
    }),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.ratking.ticket",
  key: "tid",
} as const;
