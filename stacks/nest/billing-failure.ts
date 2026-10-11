import { Schema } from "effect";

export class RelayFailure extends Schema.TaggedError<RelayFailure>()(
  "BillingRelayFailure",
  { operation: Schema.String }
) {}
