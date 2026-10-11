import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Guess = Schema.StructWithRest(
  Schema.Struct({
    model: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u)
    ),
    packets: Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1)
    ),
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
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["model", "packets", "thinking", "workType"].includes(key)
      ),
    { expected: "only allowed keys: model, packets, thinking, workType" }
  )
);

export type GuessValue = typeof Guess.Type;

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.agentgraph.checkin"),
    brief: Schema.NullOr(
      Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^\/[^\s]*$/u)
      )
    ),
    briefMachine: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u)
    ),
    cleanup: Schema.optionalKey(
      Schema.Array(
        Runtime.lexString({ type: "string" }).check(Schema.isMinLength(1))
      ).check(Schema.isMinLength(0), Schema.isMaxLength(9_007_199_254_740_991))
    ),
    critical: Schema.Boolean,
    goal: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(280)
    ),
    guess: Guess,
    mode: Runtime.lexString({ enum: ["ask", "fyi"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["ask", "fyi"]))
    ),
    note: Schema.optionalKey(
      Runtime.lexString({ type: "string" }).check(Schema.isMaxLength(1000))
    ),
    project: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/u)
    ),
    repo: Runtime.lexString({ type: "string" }).check(Schema.isMinLength(1)),
    row: Schema.NullOr(
      Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-z][a-z0-9_-]{0,31}$/u)
      )
    ),
    supersedes: Schema.optionalKey(Runtime.lexString({ type: "string" })),
    version: Runtime.lexString({ enum: ["0.1"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["0.1"]))
    ),
    writeScope: Schema.Array(Runtime.lexString({ type: "string" })).check(
      Schema.isMinLength(0),
      Schema.isMaxLength(9_007_199_254_740_991)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        [
          "$type",
          "brief",
          "briefMachine",
          "cleanup",
          "critical",
          "goal",
          "guess",
          "mode",
          "note",
          "project",
          "repo",
          "row",
          "supersedes",
          "version",
          "writeScope",
        ].includes(key)
      ),
    {
      expected:
        "only allowed keys: $type, brief, briefMachine, cleanup, critical, goal, guess, mode, note, project, repo, row, supersedes, version, writeScope",
    }
  )
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.agentgraph.checkin",
  key: "tid",
} as const;
