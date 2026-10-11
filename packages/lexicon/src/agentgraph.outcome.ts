import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.agentgraph.outcome"),
    checkIn: Runtime.lexString({ type: "string" }),
    gate: Runtime.lexString({
      enum: ["pass", "fail", "skip"],
      type: "string",
    }).pipe(Schema.decodeTo(Schema.Literals(["pass", "fail", "skip"]))),
    landedAs: Schema.optionalKey(Runtime.lexString({ type: "string" })),
    outcome: Runtime.lexString({
      enum: ["committed", "rejected", "no_changes"],
      type: "string",
    }).pipe(
      Schema.decodeTo(Schema.Literals(["committed", "rejected", "no_changes"]))
    ),
    version: Runtime.lexString({ enum: ["0.1"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["0.1"]))
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["$type", "checkIn", "gate", "landedAs", "outcome", "version"].includes(
          key
        )
      ),
    {
      expected:
        "only allowed keys: $type, checkIn, gate, landedAs, outcome, version",
    }
  )
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.agentgraph.outcome",
  key: "tid",
} as const;
