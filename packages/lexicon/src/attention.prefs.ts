import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Group = Schema.StructWithRest(
  Schema.Struct({
    group: Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) => Object.keys(value).every((key) => ["group"].includes(key)),
    { expected: "only allowed keys: group" }
  )
);

export type GroupValue = typeof Group.Type;

export const Jev = Schema.StructWithRest(
  Schema.Struct({
    judgment: Runtime.lexString({
      maxLength: 280,
      minLength: 1,
      type: "string",
    }),
    laterBp: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(10_000)
    ),
    nowBp: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(10_000)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["judgment", "laterBp", "nowBp"].includes(key)
      ),
    { expected: "only allowed keys: judgment, laterBp, nowBp" }
  )
);

export type JevValue = typeof Jev.Type;

export const Name = Runtime.lexString({
  maxLength: 128,
  minLength: 1,
  type: "string",
}).check(Schema.isPattern(/^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/u));

export type NameValue = typeof Name.Type;

export const Model = Schema.StructWithRest(
  Schema.Struct({
    body: Runtime.lexString({
      enum: ["never", "summary", "full"],
      type: "string",
    }).pipe(Schema.decodeTo(Schema.Literals(["never", "summary", "full"]))),
    jev: Schema.optionalKey(Jev),
    kind: Runtime.lexString({
      enum: ["none", "jev", "service"],
      type: "string",
    }).pipe(Schema.decodeTo(Schema.Literals(["none", "jev", "service"]))),
    service: Schema.optionalKey(
      Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }).check(
        Schema.isPattern(
          /^(?:did:[a-z]+:[^\s]+|[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*)$/u
        )
      )
    ),
    timeoutMs: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(600_000)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
)
  .check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          ["body", "jev", "kind", "service", "timeoutMs"].includes(key)
        ),
      { expected: "only allowed keys: body, jev, kind, service, timeoutMs" }
    )
  )
  .check(
    Schema.makeFilter(
      (value) => value.kind !== "jev" || value.jev !== undefined,
      { expected: "jev: required when kind is jev" }
    )
  );

export type ModelValue = typeof Model.Type;

export const Main = Schema.StructWithRest(
  Schema.Struct({
    allow: Schema.Array(Name).check(
      Schema.isMinLength(0),
      Schema.isMaxLength(256)
    ),
    forward: Schema.Array(Name).check(
      Schema.isMinLength(0),
      Schema.isMaxLength(256)
    ),
    log: Schema.Boolean,
    model: Model,
    mute: Schema.Array(
      Schema.Union([
        Schema.StructWithRest(
          Schema.Struct({
            $type: Schema.Literal("sh.mschf.ratking.attention.prefs#thread"),
            thread: Runtime.lexString({
              maxLength: 256,
              minLength: 1,
              type: "string",
            }),
          }),
          [Schema.Record(Schema.String, Runtime.Data)]
        ).check(
          Schema.makeFilter(
            (value) =>
              Object.keys(value).every((key) =>
                ["$type", "thread"].includes(key)
              ),
            { expected: "only allowed keys: $type, thread" }
          )
        ),
        Schema.StructWithRest(
          Schema.Struct({
            $type: Schema.Literal("sh.mschf.ratking.attention.prefs#group"),
            group: Runtime.lexString({
              maxLength: 256,
              minLength: 1,
              type: "string",
            }),
          }),
          [Schema.Record(Schema.String, Runtime.Data)]
        ).check(
          Schema.makeFilter(
            (value) =>
              Object.keys(value).every((key) =>
                ["$type", "group"].includes(key)
              ),
            { expected: "only allowed keys: $type, group" }
          )
        ),
      ])
    ).check(Schema.isMinLength(0), Schema.isMaxLength(256)),
    refuse: Schema.Array(Name).check(
      Schema.isMinLength(0),
      Schema.isMaxLength(256)
    ),
    version: Runtime.lexString({ const: "0.1", type: "string" }).pipe(
      Schema.decodeTo(Schema.Literal("0.1"))
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        [
          "allow",
          "forward",
          "log",
          "model",
          "mute",
          "refuse",
          "version",
        ].includes(key)
      ),
    {
      expected:
        "only allowed keys: allow, forward, log, model, mute, refuse, version",
    }
  )
);

export type MainValue = typeof Main.Type;

export const Thread = Schema.StructWithRest(
  Schema.Struct({
    thread: Runtime.lexString({ maxLength: 256, minLength: 1, type: "string" }),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) => Object.keys(value).every((key) => ["thread"].includes(key)),
    { expected: "only allowed keys: thread" }
  )
);

export type ThreadValue = typeof Thread.Type;
