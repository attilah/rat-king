import { Effect, Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Params: Schema.StructWithRest<Schema.Struct<{
    readonly did: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ParamsValue = typeof Params.Type;
export declare const Input: Schema.Undefined;
export type InputValue = typeof Input.Type;
export declare const Output: Schema.StructWithRest<Schema.Struct<{
    readonly status: Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.attention.status">;
        readonly delegate: Schema.optionalKey<Schema.String>;
        readonly exempt: Schema.optionalKey<Schema.$Array<Schema.String>>;
        readonly note: Schema.optionalKey<Schema.String>;
        readonly state: Schema.compose<Schema.Literals<readonly ["available", "busy", "dnd"]>, Schema.String>;
        readonly until: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
        readonly version: Schema.compose<Schema.Literal<"0.1">, Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type OutputValue = typeof Output.Type;
export declare const ParamsFromQuery: Schema.compose<Schema.StructWithRest<Schema.Struct<{
    readonly did: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly did: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
export declare const encodeParams: (params: {
    readonly [x: string]: Runtime.LexValue;
    readonly did: string & import("effect/Brand").Brand<"Lexicon:did">;
}) => Effect.Effect<readonly (readonly [string, string])[], Schema.SchemaError, never>;
export declare const decodeParams: (entries: readonly (readonly [string, string])[]) => Effect.Effect<{
    readonly [x: string]: Runtime.LexValue;
    readonly did: string & import("effect/Brand").Brand<"Lexicon:did">;
}, Schema.SchemaError, never>;
export declare const ErrorBody: Schema.StructWithRest<Schema.Struct<{
    readonly error: Schema.String;
    readonly message: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ErrorBodyValue = typeof ErrorBody.Type;
export declare const KnownErrors: readonly ["AuthRequired", "Forbidden"];
export type KnownError = (typeof KnownErrors)[number];
export declare const isKnownError: (value: string) => value is KnownError;
export declare const Method: {
    readonly defaults: {};
    readonly error: Schema.StructWithRest<Schema.Struct<{
        readonly error: Schema.String;
        readonly message: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly input: Schema.Undefined;
    readonly inputEncoding: "";
    readonly method: "GET";
    readonly nsid: "sh.mschf.ratking.attention.getStatus";
    readonly output: Schema.StructWithRest<Schema.Struct<{
        readonly status: Schema.StructWithRest<Schema.Struct<{
            readonly $type: Schema.Literal<"sh.mschf.ratking.attention.status">;
            readonly delegate: Schema.optionalKey<Schema.String>;
            readonly exempt: Schema.optionalKey<Schema.$Array<Schema.String>>;
            readonly note: Schema.optionalKey<Schema.String>;
            readonly state: Schema.compose<Schema.Literals<readonly ["available", "busy", "dnd"]>, Schema.String>;
            readonly until: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
            readonly version: Schema.compose<Schema.Literal<"0.1">, Schema.String>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly outputEncoding: "application/json";
    readonly params: Schema.StructWithRest<Schema.Struct<{
        readonly did: Schema.brand<Schema.String, "Lexicon:did">;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly path: "/xrpc/sh.mschf.ratking.attention.getStatus";
};
