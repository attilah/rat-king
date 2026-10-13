import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.agentgraph.friction"),
    at: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    graph: Runtime.lexString({ type: "string" }).check(Schema.isMaxLength(128)),
    id: Schema.optionalKey(
      Runtime.lexString({ type: "string" }).check(Schema.isMaxLength(64))
    ),
    kind: Runtime.lexString({
      enum: ["manual", "retry", "refusal", "surprise", "cleanup"],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals(["manual", "retry", "refusal", "surprise", "cleanup"])
      )
    ),
    minutes: Schema.optionalKey(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
      )
    ),
    project: Runtime.lexString({ type: "string" }).check(
      Schema.isMaxLength(128)
    ),
    ref: Schema.optionalKey(
      Runtime.lexString({ type: "string" }).check(Schema.isMaxLength(512))
    ),
    slice: Runtime.lexString({ type: "string" }).check(Schema.isMaxLength(128)),
    version: Runtime.lexString({ enum: ["0.1"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["0.1"]))
    ),
    what: Runtime.lexString({ type: "string" }).check(Schema.isMaxLength(280)),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        [
          "$type",
          "at",
          "graph",
          "id",
          "kind",
          "minutes",
          "project",
          "ref",
          "slice",
          "version",
          "what",
        ].includes(key)
      ),
    {
      expected:
        "only allowed keys: $type, at, graph, id, kind, minutes, project, ref, slice, version, what",
    }
  )
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.agentgraph.friction",
  key: "tid",
} as const;
