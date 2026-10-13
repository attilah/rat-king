import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.agentgraph.turn"),
    agent: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(
        /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z][a-z0-9_-]{0,31}$/u
      )
    ),
    at: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    generation: Schema.optionalKey(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
      )
    ),
    reason: Schema.optionalKey(
      Runtime.lexString({ type: "string" }).check(Schema.isMaxLength(280))
    ),
    session: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(128)
    ),
    state: Runtime.lexString({
      enum: ["working", "done", "blocked", "idle", "crashed"],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals(["working", "done", "blocked", "idle", "crashed"])
      )
    ),
    stopReason: Schema.optionalKey(
      Runtime.lexString({
        enum: ["stop", "aborted", "error", "length"],
        type: "string",
      }).pipe(
        Schema.decodeTo(Schema.Literals(["stop", "aborted", "error", "length"]))
      )
    ),
    turnId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^.+:[0-9]+$/u),
      Schema.isMaxLength(128)
    ),
    version: Runtime.lexString({ enum: ["0.1"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["0.1"]))
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
)
  .check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          [
            "$type",
            "agent",
            "at",
            "generation",
            "reason",
            "session",
            "state",
            "stopReason",
            "turnId",
            "version",
          ].includes(key)
        ),
      {
        expected:
          "only allowed keys: $type, agent, at, generation, reason, session, state, stopReason, turnId, version",
      }
    )
  )
  .check(
    Schema.makeFilter(
      (value) => !("generation" in value) || value.state === "crashed",
      { expected: "generation: allowed only when state is crashed" }
    )
  );

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.agentgraph.turn",
  key: "tid",
} as const;
