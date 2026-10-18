import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Params: Schema.Undefined;
export type ParamsValue = typeof Params.Type;
export declare const Input: Schema.StructWithRest<Schema.Struct<{
    readonly did: Schema.brand<Schema.String, "Lexicon:did">;
    readonly keyId: Schema.String;
    readonly signature: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
        readonly $bytes: Schema.Uint8ArrayFromBase64;
    }>, Schema.StructWithRest<Schema.Struct<{
        readonly $bytes: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
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
export declare const ErrorBody: Schema.StructWithRest<Schema.Struct<{
    readonly error: Schema.String;
    readonly message: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ErrorBodyValue = typeof ErrorBody.Type;
export declare const KnownErrors: readonly ["AuthRequired", "DelegateCycle", "DelegateNotFound", "DelegateSelf", "Forbidden", "InvalidRequest"];
export type KnownError = (typeof KnownErrors)[number];
export declare const isKnownError: (value: string) => value is KnownError;
export declare const Method: {
    readonly defaults: {};
    readonly error: Schema.StructWithRest<Schema.Struct<{
        readonly error: Schema.String;
        readonly message: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly input: Schema.StructWithRest<Schema.Struct<{
        readonly did: Schema.brand<Schema.String, "Lexicon:did">;
        readonly keyId: Schema.String;
        readonly signature: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
            readonly $bytes: Schema.Uint8ArrayFromBase64;
        }>, Schema.StructWithRest<Schema.Struct<{
            readonly $bytes: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
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
    readonly inputEncoding: "application/json";
    readonly method: "POST";
    readonly nsid: "sh.mschf.ratking.attention.putStatus";
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
    readonly params: Schema.Undefined;
    readonly path: "/xrpc/sh.mschf.ratking.attention.putStatus";
};
