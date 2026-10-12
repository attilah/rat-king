import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const ByteSlice = Schema.StructWithRest(
  Schema.Struct({
    byteEnd: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
    byteStart: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type ByteSliceValue = typeof ByteSlice.Type;

export const Facet = Schema.StructWithRest(
  Schema.Struct({
    features: Schema.Array(
      Schema.Union([
        Schema.StructWithRest(
          Schema.Struct({
            $type: Schema.Literal("sh.mschf.ratking.desk.defs#mention"),
            did: Runtime.lexString({ format: "did", type: "string" }).pipe(
              Schema.brand("Lexicon:did")
            ),
          }),
          [Schema.Record(Schema.String, Runtime.Data)]
        ),
        Runtime.TaggedMap.check(
          Schema.makeFilter(
            (value) =>
              !["sh.mschf.ratking.desk.defs#mention"].includes(value.$type),
            { expected: "unknown union tag only" }
          )
        ),
      ])
    ).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
    index: ByteSlice,
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type FacetValue = typeof Facet.Type;

export const Mention = Schema.StructWithRest(
  Schema.Struct({
    did: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MentionValue = typeof Mention.Type;

export const StrongRef = Schema.StructWithRest(
  Schema.Struct({
    cid: Runtime.lexString({ maxLength: 64, type: "string" }),
    uri: Runtime.lexString({ maxLength: 512, type: "string" }),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type StrongRefValue = typeof StrongRef.Type;

export const ReplyRef = Schema.StructWithRest(
  Schema.Struct({ parent: StrongRef, root: StrongRef }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type ReplyRefValue = typeof ReplyRef.Type;

export const OwnerItem = Schema.StructWithRest(
  Schema.Struct({
    author: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
    cid: Runtime.lexString({ type: "string" }).check(
      Schema.isPattern(/^[0-9a-f]{32}$/u)
    ),
    createdAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    facets: Schema.optionalKey(
      Schema.Array(Facet).check(Schema.isMinLength(0), Schema.isMaxLength(8))
    ),
    kind: Runtime.lexString({
      enum: ["fyi", "progress", "done", "question", "blocked", "action"],
      type: "string",
    }).pipe(
      Schema.decodeTo(
        Schema.Literals([
          "fyi",
          "progress",
          "done",
          "question",
          "blocked",
          "action",
        ])
      )
    ),
    lane: Schema.optionalKey(
      Runtime.lexString({ maxLength: 128, type: "string" })
    ),
    project: Schema.optionalKey(
      Runtime.lexString({ maxLength: 128, type: "string" })
    ),
    refs: Schema.optionalKey(
      Schema.Array(
        Runtime.lexString({ maxLength: 1024, type: "string" })
      ).check(Schema.isMinLength(0), Schema.isMaxLength(32))
    ),
    reply: Schema.optionalKey(ReplyRef),
    text: Runtime.lexString({ maxLength: 8192, type: "string" }),
    uri: Runtime.lexString({ maxLength: 512, type: "string" }).check(
      Schema.isMinLength(1)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
).check(
  Schema.makeFilter(
    (value) =>
      Object.keys(value).every((key) =>
        [
          "author",
          "cid",
          "createdAt",
          "facets",
          "kind",
          "lane",
          "project",
          "refs",
          "reply",
          "text",
          "uri",
        ].includes(key)
      ),
    {
      expected:
        "only allowed keys: author, cid, createdAt, facets, kind, lane, project, refs, reply, text, uri",
    }
  )
);

export type OwnerItemValue = typeof OwnerItem.Type;

export const Queued = Schema.StructWithRest(
  Schema.Struct({
    item: OwnerItem,
    seq: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type QueuedValue = typeof Queued.Type;
