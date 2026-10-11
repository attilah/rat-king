import { Schema } from "effect";

export class BillingFailure extends Schema.TaggedError<BillingFailure>()(
  "BillingFailure",
  { status: Schema.Number }
) {}
