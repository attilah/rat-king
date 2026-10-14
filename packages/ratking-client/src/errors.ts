import { Schema } from "effect";

export class QuietAsk extends Schema.TaggedError<QuietAsk>()("QuietAsk", {
  code: Schema.Literal("QuietAsk"),
  debug: Schema.String,
  fix: Schema.String,
  reason: Schema.String,
  why: Schema.String,
}) {}

export const quietAsk = () =>
  new QuietAsk({
    code: "QuietAsk",
    debug:
      "Nothing reached admission. Quiet is sender intent for messages and replies only.",
    fix: "Remove quiet to ask, or send a quiet message instead.",
    reason: "An ask requires attention and cannot be quiet.",
    why: "An ask requires attention and cannot be quiet.",
  });

const Reasoned = Schema.Struct({ reason: Schema.String });

export const reasonOf = (error: { readonly _tag: string }) =>
  Schema.is(Reasoned)(error) ? error.reason : error._tag;
