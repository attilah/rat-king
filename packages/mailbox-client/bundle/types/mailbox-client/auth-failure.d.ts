import { Schema } from "effect";
declare const ServiceAuthFailure_base: Schema.Class<ServiceAuthFailure, Schema.TaggedStruct<"XrpcFailure", {
    readonly error: Schema.String;
    readonly message: Schema.optionalKey<Schema.String>;
    readonly response: Schema.$Record<Schema.String, Schema.Codec<Schema.Json, Schema.Json, never, never>>;
    readonly status: Schema.Int;
}>, import("effect/Cause").YieldableError>;
export declare class ServiceAuthFailure extends ServiceAuthFailure_base {
}
export {};
