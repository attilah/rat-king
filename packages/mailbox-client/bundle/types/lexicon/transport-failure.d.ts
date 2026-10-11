import { Schema } from "effect";
declare const TransportFailure_base: Schema.Class<TransportFailure, Schema.TaggedStruct<"TransportFailure", {
    readonly cause: Schema.Defect;
    readonly reason: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class TransportFailure extends TransportFailure_base {
}
export {};
