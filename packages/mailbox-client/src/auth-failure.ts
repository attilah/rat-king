import { Schema } from "effect";

export class ServiceAuthFailure extends Schema.TaggedError<ServiceAuthFailure>()(
  "XrpcFailure",
  {
    error: Schema.String,
    message: Schema.optionalKey(Schema.String),
    response: Schema.Record(Schema.String, Schema.Json),
    status: Schema.Int,
  }
) {}
