import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Quote = Schema.StructWithRest(
  Schema.Struct({
    source: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(300)
    ),
    text: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(600)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type QuoteValue = typeof Quote.Type;

export const Source = Schema.StructWithRest(
  Schema.Struct({
    host: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-z0-9-]+$/u),
      Schema.isMinLength(1),
      Schema.isMaxLength(64)
    ),
    line: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
    path: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(512)
    ),
    quote: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1200)
    ),
    sha256: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type SourceValue = typeof Source.Type;

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.rulegarden.finding"),
    action: Runtime.lexString({
      enum: [
        "adopt-principle",
        "delete",
        "replace",
        "narrow",
        "merge",
        "update",
        "sync-install",
      ],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals([
          "adopt-principle",
          "delete",
          "replace",
          "narrow",
          "merge",
          "update",
          "sync-install",
        ])
      )
    ),
    at: Runtime.lexString({ format: "datetime", type: "string" })
      .check(Schema.isMinLength(1), Schema.isMaxLength(40))
      .pipe(Schema.brand("Lexicon:datetime")),
    bytesSaved: Schema.NullOr(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
      )
    ),
    claim: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1200)
    ),
    evidence: Schema.Array(
      Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(600)
      )
    ).check(Schema.isMinLength(0), Schema.isMaxLength(9_007_199_254_740_991)),
    id: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[a-f0-9]{64}$/u)
    ),
    joelQuote: Schema.NullOr(Quote),
    kind: Runtime.lexString({
      enum: ["principle", "contradiction", "bloat", "stale"],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals(["principle", "contradiction", "bloat", "stale"])
      )
    ),
    load: Runtime.lexString({
      enum: ["always", "skill-trigger", "on-demand"],
      type: "string",
    }).pipe(
      Schema.decodeTo(Schema.Literals(["always", "skill-trigger", "on-demand"]))
    ),
    owner: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    peon: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    ),
    principles: Schema.Array(
      Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(300)
      )
    ).check(Schema.isMinLength(0), Schema.isMaxLength(9_007_199_254_740_991)),
    proposal: Runtime.lexString({ type: "string" }).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1600)
    ),
    severity: Runtime.lexString({
      enum: ["high", "medium", "low"],
      type: "string",
    }).pipe(Schema.decodeTo(Schema.Literals(["high", "medium", "low"]))),
    spans: Schema.Array(Source).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(9_007_199_254_740_991)
    ),
    staleRefs: Schema.Array(
      Runtime.lexString({ type: "string" }).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(200)
      )
    ).check(Schema.isMinLength(0), Schema.isMaxLength(9_007_199_254_740_991)),
    wave: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        [
          "$type",
          "action",
          "at",
          "bytesSaved",
          "claim",
          "evidence",
          "id",
          "joelQuote",
          "kind",
          "load",
          "owner",
          "peon",
          "principles",
          "proposal",
          "severity",
          "spans",
          "staleRefs",
          "wave",
        ].includes(key)
      ),
    {
      expected:
        "only allowed keys: $type, action, at, bytesSaved, claim, evidence, id, joelQuote, kind, load, owner, peon, principles, proposal, severity, spans, staleRefs, wave",
    }
  )
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.rulegarden.finding",
  key: "tid",
} as const;
