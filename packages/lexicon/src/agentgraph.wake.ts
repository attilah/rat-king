import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.agentgraph.wake"),
    code: Schema.optionalKey(
      Runtime.lexString({ maxLength: 256, type: "string" })
    ),
    failure: Schema.optionalKey(
      Runtime.lexString({ maxLength: 1024, type: "string" })
    ),
    finishedAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    kind: Runtime.lexString({
      enum: ["agent_state", "pane_output", "ping"],
      type: "string",
    }).pipe(
      Schema.decodeTo(Schema.Literals(["agent_state", "pane_output", "ping"]))
    ),
    label: Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }),
    pane: Schema.optionalKey(
      Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" })
    ),
    result: Schema.optionalKey(
      Runtime.lexString({ maxLength: 2048, type: "string" }).check(
        Schema.isPattern(/^[^\n]*(?:\n[^\n]*){0,11}$(?![\s\S])/u)
      )
    ),
    source: Runtime.lexString({
      enum: ["herdr_watch", "herdr_ping_wait"],
      type: "string",
    }).pipe(
      Schema.decodeTo(Schema.Literals(["herdr_watch", "herdr_ping_wait"]))
    ),
    startedAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    status: Runtime.lexString({
      enum: ["matched", "timedOut", "targetGone", "failed", "cancelled"],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals([
          "matched",
          "timedOut",
          "targetGone",
          "failed",
          "cancelled",
        ])
      )
    ),
    target: Schema.optionalKey(
      Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" })
    ),
    targetPaneId: Schema.optionalKey(
      Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" })
    ),
    targetTerminalId: Schema.optionalKey(
      Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" })
    ),
    text: Runtime.lexString({ maxLength: 8192, type: "string" }),
    watch: Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        [
          "$type",
          "code",
          "failure",
          "finishedAt",
          "kind",
          "label",
          "pane",
          "result",
          "source",
          "startedAt",
          "status",
          "target",
          "targetPaneId",
          "targetTerminalId",
          "text",
          "watch",
        ].includes(key)
      ),
    {
      expected:
        "only allowed keys: $type, code, failure, finishedAt, kind, label, pane, result, source, startedAt, status, target, targetPaneId, targetTerminalId, text, watch",
    }
  )
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.agentgraph.wake",
  key: "tid",
} as const;
