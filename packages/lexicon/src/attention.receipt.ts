import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.ratking.attention.receipt"),
    operation: Runtime.lexString({
      enum: ["putPreferences", "putStatus"],
      type: "string",
    }).pipe(Schema.decodeTo(Schema.Literals(["putPreferences", "putStatus"]))),
    seq: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.ratking.attention.receipt",
  key: "any",
} as const;
