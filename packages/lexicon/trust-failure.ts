import { Schema } from "effect";

export class TrustFailure extends Schema.TaggedError<TrustFailure>()(
  "TrustFailure",
  { reason: Schema.String }
) {}
