import { Schema } from "effect";
declare const EnvelopeFailure_base: Schema.Class<EnvelopeFailure, Schema.TaggedStruct<"EnvelopeFailure", {
    readonly reason: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class EnvelopeFailure extends EnvelopeFailure_base {
}
export {};
