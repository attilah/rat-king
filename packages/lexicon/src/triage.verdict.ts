import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.ratking.triage.verdict"),
    arrivalId: Runtime.lexString({ minLength: 1, type: "string" }),
    modelId: Runtime.lexString({ minLength: 1, type: "string" }),
    probabilityBp: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(10_000)
    ),
    reason: Runtime.lexString({ maxLength: 280, type: "string" }),
    verdict: Runtime.lexString({
      enum: ["Now", "Next", "Later", "Never"],
      type: "string",
    }).pipe(
      Schema.decodeTo(Schema.Literals(["Now", "Next", "Later", "Never"]))
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.ratking.triage.verdict",
  key: "any",
} as const;
