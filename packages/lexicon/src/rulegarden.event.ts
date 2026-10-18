import { Schema } from "effect";

import * as RulegardenFinding from "./rulegarden.finding.ts";
import * as Runtime from "./runtime.ts";

export const Agree = Schema.StructWithRest(
  Schema.Struct({
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    by: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    findingId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    kind: Runtime.lexString({ enum: ["agree"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["agree"]))
    ),
    text: Schema.NullOr(
      Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(1200)
      )
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["at", "by", "findingId", "kind", "text"].includes(key)
      ),
    { expected: "only allowed keys: at, by, findingId, kind, text" }
  )
);

export type AgreeValue = typeof Agree.Type;

export const Comment = Schema.StructWithRest(
  Schema.Struct({
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    by: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    findingId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    kind: Runtime.lexString({ enum: ["comment"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["comment"]))
    ),
    text: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1200)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["at", "by", "findingId", "kind", "text"].includes(key)
      ),
    { expected: "only allowed keys: at, by, findingId, kind, text" }
  )
);

export type CommentValue = typeof Comment.Type;

export const Dispute = Schema.StructWithRest(
  Schema.Struct({
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    by: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    findingId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    kind: Runtime.lexString({ enum: ["dispute"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["dispute"]))
    ),
    source: RulegardenFinding.Source,
    text: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1200)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["at", "by", "findingId", "kind", "source", "text"].includes(key)
      ),
    { expected: "only allowed keys: at, by, findingId, kind, source, text" }
  )
);

export type DisputeValue = typeof Dispute.Type;

export const Duplicate = Schema.StructWithRest(
  Schema.Struct({
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    by: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    findingId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    kind: Runtime.lexString({ enum: ["duplicate"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["duplicate"]))
    ),
    of: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["at", "by", "findingId", "kind", "of"].includes(key)
      ),
    { expected: "only allowed keys: at, by, findingId, kind, of" }
  )
);

export type DuplicateValue = typeof Duplicate.Type;

export const Evidence = Schema.StructWithRest(
  Schema.Struct({
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    by: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    findingId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    kind: Runtime.lexString({ enum: ["evidence"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["evidence"]))
    ),
    source: Schema.NullOr(RulegardenFinding.Source),
    text: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1200)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["at", "by", "findingId", "kind", "source", "text"].includes(key)
      ),
    { expected: "only allowed keys: at, by, findingId, kind, source, text" }
  )
);

export type EvidenceValue = typeof Evidence.Type;

export const Fixed = Schema.StructWithRest(
  Schema.Struct({
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    by: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    commit: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(120)
    ),
    findingId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    kind: Runtime.lexString({ enum: ["fixed"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["fixed"]))
    ),
    repo: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    text: Schema.NullOr(
      Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(1200)
      )
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["at", "by", "commit", "findingId", "kind", "repo", "text"].includes(
          key
        )
      ),
    {
      expected:
        "only allowed keys: at, by, commit, findingId, kind, repo, text",
    }
  )
);

export type FixedValue = typeof Fixed.Type;

export const Main = Schema.Union([
  Schema.StructWithRest(
    Schema.Struct({
      $type: Schema.Literal("sh.mschf.rulegarden.event"),
      at: Runtime.lexString({ format: "datetime", type: "string" })
        .check(Schema.isMinLength(1), Schema.isMaxLength(40))
        .pipe(Schema.brand("Lexicon:datetime")),
      by: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      findingId: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
      kind: Runtime.lexString({ enum: ["agree"], type: "string" }).pipe(
        Schema.decodeTo(Schema.Literals(["agree"]))
      ),
      text: Schema.NullOr(
        Runtime.lexString({ type: "string" }).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(1200)
        )
      ),
    }),
    [Schema.Record(Schema.String, Runtime.Data)]
  ).check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          ["$type", "at", "by", "findingId", "kind", "text"].includes(key)
        ),
      { expected: "only allowed keys: $type, at, by, findingId, kind, text" }
    )
  ),
  Schema.StructWithRest(
    Schema.Struct({
      $type: Schema.Literal("sh.mschf.rulegarden.event"),
      at: Runtime.lexString({ format: "datetime", type: "string" })
        .check(Schema.isMinLength(1), Schema.isMaxLength(40))
        .pipe(Schema.brand("Lexicon:datetime")),
      by: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      findingId: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
      kind: Runtime.lexString({ enum: ["dispute"], type: "string" }).pipe(
        Schema.decodeTo(Schema.Literals(["dispute"]))
      ),
      source: RulegardenFinding.Source,
      text: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(1200)
      ),
    }),
    [Schema.Record(Schema.String, Runtime.Data)]
  ).check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          ["$type", "at", "by", "findingId", "kind", "source", "text"].includes(
            key
          )
        ),
      {
        expected:
          "only allowed keys: $type, at, by, findingId, kind, source, text",
      }
    )
  ),
  Schema.StructWithRest(
    Schema.Struct({
      $type: Schema.Literal("sh.mschf.rulegarden.event"),
      at: Runtime.lexString({ format: "datetime", type: "string" })
        .check(Schema.isMinLength(1), Schema.isMaxLength(40))
        .pipe(Schema.brand("Lexicon:datetime")),
      by: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      findingId: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
      kind: Runtime.lexString({ enum: ["evidence"], type: "string" }).pipe(
        Schema.decodeTo(Schema.Literals(["evidence"]))
      ),
      source: Schema.NullOr(RulegardenFinding.Source),
      text: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(1200)
      ),
    }),
    [Schema.Record(Schema.String, Runtime.Data)]
  ).check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          ["$type", "at", "by", "findingId", "kind", "source", "text"].includes(
            key
          )
        ),
      {
        expected:
          "only allowed keys: $type, at, by, findingId, kind, source, text",
      }
    )
  ),
  Schema.StructWithRest(
    Schema.Struct({
      $type: Schema.Literal("sh.mschf.rulegarden.event"),
      at: Runtime.lexString({ format: "datetime", type: "string" })
        .check(Schema.isMinLength(1), Schema.isMaxLength(40))
        .pipe(Schema.brand("Lexicon:datetime")),
      by: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      findingId: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
      kind: Runtime.lexString({ enum: ["comment"], type: "string" }).pipe(
        Schema.decodeTo(Schema.Literals(["comment"]))
      ),
      text: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(1200)
      ),
    }),
    [Schema.Record(Schema.String, Runtime.Data)]
  ).check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          ["$type", "at", "by", "findingId", "kind", "text"].includes(key)
        ),
      { expected: "only allowed keys: $type, at, by, findingId, kind, text" }
    )
  ),
  Schema.StructWithRest(
    Schema.Struct({
      $type: Schema.Literal("sh.mschf.rulegarden.event"),
      at: Runtime.lexString({ format: "datetime", type: "string" })
        .check(Schema.isMinLength(1), Schema.isMaxLength(40))
        .pipe(Schema.brand("Lexicon:datetime")),
      by: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      commit: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(120)
      ),
      findingId: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
      kind: Runtime.lexString({ enum: ["fixed"], type: "string" }).pipe(
        Schema.decodeTo(Schema.Literals(["fixed"]))
      ),
      repo: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      text: Schema.NullOr(
        Runtime.lexString({ type: "string" }).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(1200)
        )
      ),
    }),
    [Schema.Record(Schema.String, Runtime.Data)]
  ).check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          [
            "$type",
            "at",
            "by",
            "commit",
            "findingId",
            "kind",
            "repo",
            "text",
          ].includes(key)
        ),
      {
        expected:
          "only allowed keys: $type, at, by, commit, findingId, kind, repo, text",
      }
    )
  ),
  Schema.StructWithRest(
    Schema.Struct({
      $type: Schema.Literal("sh.mschf.rulegarden.event"),
      at: Runtime.lexString({ format: "datetime", type: "string" })
        .check(Schema.isMinLength(1), Schema.isMaxLength(40))
        .pipe(Schema.brand("Lexicon:datetime")),
      by: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      findingId: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
      kind: Runtime.lexString({ enum: ["wontfix"], type: "string" }).pipe(
        Schema.decodeTo(Schema.Literals(["wontfix"]))
      ),
      text: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(1200)
      ),
    }),
    [Schema.Record(Schema.String, Runtime.Data)]
  ).check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          ["$type", "at", "by", "findingId", "kind", "text"].includes(key)
        ),
      { expected: "only allowed keys: $type, at, by, findingId, kind, text" }
    )
  ),
  Schema.StructWithRest(
    Schema.Struct({
      $type: Schema.Literal("sh.mschf.rulegarden.event"),
      at: Runtime.lexString({ format: "datetime", type: "string" })
        .check(Schema.isMinLength(1), Schema.isMaxLength(40))
        .pipe(Schema.brand("Lexicon:datetime")),
      by: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      findingId: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
      kind: Runtime.lexString({ enum: ["reopen"], type: "string" }).pipe(
        Schema.decodeTo(Schema.Literals(["reopen"]))
      ),
      text: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(1200)
      ),
    }),
    [Schema.Record(Schema.String, Runtime.Data)]
  ).check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          ["$type", "at", "by", "findingId", "kind", "text"].includes(key)
        ),
      { expected: "only allowed keys: $type, at, by, findingId, kind, text" }
    )
  ),
  Schema.StructWithRest(
    Schema.Struct({
      $type: Schema.Literal("sh.mschf.rulegarden.event"),
      at: Runtime.lexString({ format: "datetime", type: "string" })
        .check(Schema.isMinLength(1), Schema.isMaxLength(40))
        .pipe(Schema.brand("Lexicon:datetime")),
      by: Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      ),
      findingId: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
      kind: Runtime.lexString({ enum: ["duplicate"], type: "string" }).pipe(
        Schema.decodeTo(Schema.Literals(["duplicate"]))
      ),
      of: Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(/^[a-f0-9]{64}$/u)
      ),
    }),
    [Schema.Record(Schema.String, Runtime.Data)]
  ).check(
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every((key) =>
          ["$type", "at", "by", "findingId", "kind", "of"].includes(key)
        ),
      { expected: "only allowed keys: $type, at, by, findingId, kind, of" }
    )
  ),
]);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.rulegarden.event",
  key: "tid",
} as const;

export const Reopen = Schema.StructWithRest(
  Schema.Struct({
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    by: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    findingId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    kind: Runtime.lexString({ enum: ["reopen"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["reopen"]))
    ),
    text: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1200)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["at", "by", "findingId", "kind", "text"].includes(key)
      ),
    { expected: "only allowed keys: at, by, findingId, kind, text" }
  )
);

export type ReopenValue = typeof Reopen.Type;

export const Wontfix = Schema.StructWithRest(
  Schema.Struct({
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    by: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    findingId: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    kind: Runtime.lexString({ enum: ["wontfix"], type: "string" }).pipe(
      Schema.decodeTo(Schema.Literals(["wontfix"]))
    ),
    text: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1200)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        ["at", "by", "findingId", "kind", "text"].includes(key)
      ),
    { expected: "only allowed keys: at, by, findingId, kind, text" }
  )
);

export type WontfixValue = typeof Wontfix.Type;
