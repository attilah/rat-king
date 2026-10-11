import { Schema } from "effect";
import * as Runtime from "./runtime.js";
declare const XrpcFailure_base: Schema.Class<XrpcFailure, Schema.TaggedStruct<"XrpcFailure", {
    readonly error: Schema.String;
    readonly message: Schema.optionalKey<Schema.String>;
    readonly response: Schema.Union<readonly [Schema.String, Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly status: Schema.Int;
}>, import("effect/Cause").YieldableError>;
export declare class XrpcFailure extends XrpcFailure_base {
}
export {};
