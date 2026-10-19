import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.ratking.pass"),
    desk: Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }),
    deskDid: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
    exp: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
    iat: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
    nonce: Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }),
    run: Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }),
    scope: Schema.Array(
      Runtime.lexString({ maxLength: 512, minLength: 1, type: "string" })
    ).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
    v: Schema.Literal(1).check(
      Schema.isGreaterThanOrEqualTo(-9_007_199_254_740_991),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
    worker: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.ratking.pass",
  key: "tid",
} as const;
