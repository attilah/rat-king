import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const CleanupItem = Schema.StructWithRest(
  Schema.Struct({
    owner: Runtime.lexString({ type: "string" }).check(Schema.isMinLength(1)),
    what: Runtime.lexString({ type: "string" }).check(Schema.isMinLength(1)),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) => ["owner", "what"].includes(key)),
    { expected: "only allowed keys: owner, what" }
  )
);

export type CleanupItemValue = typeof CleanupItem.Type;

export const PacketsItem = Schema.StructWithRest(
  Schema.Struct({
    gates: Schema.Array(Runtime.lexString({ type: "string" })).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(9_007_199_254_740_991)
    ),
    model: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u)
    ),
    order: Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1)
    ),
    parallelWith: Schema.Array(
      Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
    ).check(Schema.isMinLength(0), Schema.isMaxLength(9_007_199_254_740_991)),
    thinking: Runtime.lexString({
      enum: ["off", "minimal", "low", "medium", "high", "xhigh"],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh"])
      )
    ),
    workType: Runtime.lexString({
      enum: [
        "bugfix",
        "refactor",
        "investigation",
        "scan",
        "gather",
        "ui",
        "feature",
      ],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals([
          "bugfix",
          "refactor",
          "investigation",
          "scan",
          "gather",
          "ui",
          "feature",
        ])
      )
    ),
    writeScope: Schema.Array(Runtime.lexString({ type: "string" })).check(
      Schema.isMinLength(0),
      Schema.isMaxLength(9_007_199_254_740_991)
    ),
    writer: Runtime.lexString({ type: "string" }),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        [
          "gates",
          "model",
          "order",
          "parallelWith",
          "thinking",
          "workType",
          "writeScope",
          "writer",
        ].includes(key)
      ),
    {
      expected:
        "only allowed keys: gates, model, order, parallelWith, thinking, workType, writeScope, writer",
    }
  )
);

export type PacketsItemValue = typeof PacketsItem.Type;

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.agentgraph.plan"),
    checkIn: Runtime.lexString({ type: "string" }),
    cleanup: Schema.Array(CleanupItem).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(9_007_199_254_740_991)
    ),
    constraints: Schema.Array(Runtime.lexString({ type: "string" })).check(
      Schema.isMinLength(0),
      Schema.isMaxLength(9_007_199_254_740_991)
    ),
    packets: Schema.Array(PacketsItem).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(9_007_199_254_740_991)
    ),
    releaseWhen: Schema.optionalKey(
      Runtime.lexString({ type: "string" }).check(Schema.isMinLength(1))
    ),
    verdict: Runtime.lexString({
      enum: ["go-as-proposed", "go-with-changes", "hold"],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals(["go-as-proposed", "go-with-changes", "hold"])
      )
    ),
    version: Runtime.lexString({ enum: ["0.2"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["0.2"]))
    ),
    why: Runtime.lexString({ type: "string" }).check(Schema.isMinLength(1)),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
)
  .check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          [
            "$type",
            "checkIn",
            "cleanup",
            "constraints",
            "packets",
            "releaseWhen",
            "verdict",
            "version",
            "why",
          ].includes(key)
        ),
      {
        expected:
          "only allowed keys: $type, checkIn, cleanup, constraints, packets, releaseWhen, verdict, version, why",
      }
    )
  )
  .check(
    Schema.makeFilter(
      (value) => value.verdict !== "hold" || value.releaseWhen !== undefined,
      { expected: "releaseWhen: required when verdict is hold" }
    )
  )
  .check(
    Schema.makeFilter(
      (value) => !("releaseWhen" in value) || value.verdict === "hold",
      { expected: "releaseWhen: allowed only when verdict is hold" }
    )
  );

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.agentgraph.plan",
  key: "tid",
} as const;
