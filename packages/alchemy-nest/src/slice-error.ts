import { Schema } from "effect";

export class SliceError extends Schema.TaggedError<SliceError>()("SliceError", {
  reason: Schema.String,
  status: Schema.Int,
}) {}
