import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Params: Schema.Undefined;
export type ParamsValue = typeof Params.Type;
export declare const Input: Schema.StructWithRest<Schema.Struct<{
    readonly did: Schema.brand<Schema.String, "Lexicon:did">;
    readonly keyId: Schema.String;
    readonly prefs: Schema.StructWithRest<Schema.Struct<{
        readonly allow: Schema.$Array<Schema.String>;
        readonly forward: Schema.$Array<Schema.String>;
        readonly log: Schema.Boolean;
        readonly model: Schema.StructWithRest<Schema.Struct<{
            readonly body: Schema.compose<Schema.Literals<readonly ["never", "summary", "full"]>, Schema.String>;
            readonly jev: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
                readonly judgment: Schema.String;
                readonly laterBp: Schema.Int;
                readonly nowBp: Schema.Int;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
            readonly kind: Schema.compose<Schema.Literals<readonly ["none", "jev", "service"]>, Schema.String>;
            readonly service: Schema.optionalKey<Schema.String>;
            readonly timeoutMs: Schema.Int;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly mute: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
            readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#thread">;
            readonly thread: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
            readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#group">;
            readonly group: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
        readonly refuse: Schema.$Array<Schema.String>;
        readonly version: Schema.compose<Schema.Literal<"0.1">, Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly signature: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
        readonly $bytes: Schema.Uint8ArrayFromBase64;
    }>, Schema.StructWithRest<Schema.Struct<{
        readonly $bytes: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type InputValue = typeof Input.Type;
export declare const Output: Schema.StructWithRest<Schema.Struct<{
    readonly prefs: Schema.StructWithRest<Schema.Struct<{
        readonly allow: Schema.$Array<Schema.String>;
        readonly forward: Schema.$Array<Schema.String>;
        readonly log: Schema.Boolean;
        readonly model: Schema.StructWithRest<Schema.Struct<{
            readonly body: Schema.compose<Schema.Literals<readonly ["never", "summary", "full"]>, Schema.String>;
            readonly jev: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
                readonly judgment: Schema.String;
                readonly laterBp: Schema.Int;
                readonly nowBp: Schema.Int;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
            readonly kind: Schema.compose<Schema.Literals<readonly ["none", "jev", "service"]>, Schema.String>;
            readonly service: Schema.optionalKey<Schema.String>;
            readonly timeoutMs: Schema.Int;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly mute: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
            readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#thread">;
            readonly thread: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
            readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#group">;
            readonly group: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
        readonly refuse: Schema.$Array<Schema.String>;
        readonly version: Schema.compose<Schema.Literal<"0.1">, Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type OutputValue = typeof Output.Type;
export declare const ErrorBody: Schema.StructWithRest<Schema.Struct<{
    readonly error: Schema.String;
    readonly message: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ErrorBodyValue = typeof ErrorBody.Type;
export declare const KnownErrors: readonly ["AuthRequired", "Forbidden", "InvalidRequest"];
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
        readonly prefs: Schema.StructWithRest<Schema.Struct<{
            readonly allow: Schema.$Array<Schema.String>;
            readonly forward: Schema.$Array<Schema.String>;
            readonly log: Schema.Boolean;
            readonly model: Schema.StructWithRest<Schema.Struct<{
                readonly body: Schema.compose<Schema.Literals<readonly ["never", "summary", "full"]>, Schema.String>;
                readonly jev: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
                    readonly judgment: Schema.String;
                    readonly laterBp: Schema.Int;
                    readonly nowBp: Schema.Int;
                }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
                readonly kind: Schema.compose<Schema.Literals<readonly ["none", "jev", "service"]>, Schema.String>;
                readonly service: Schema.optionalKey<Schema.String>;
                readonly timeoutMs: Schema.Int;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
            readonly mute: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
                readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#thread">;
                readonly thread: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
                readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#group">;
                readonly group: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
            readonly refuse: Schema.$Array<Schema.String>;
            readonly version: Schema.compose<Schema.Literal<"0.1">, Schema.String>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly signature: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
            readonly $bytes: Schema.Uint8ArrayFromBase64;
        }>, Schema.StructWithRest<Schema.Struct<{
            readonly $bytes: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly inputEncoding: "application/json";
    readonly method: "POST";
    readonly nsid: "sh.mschf.ratking.attention.putPreferences";
    readonly output: Schema.StructWithRest<Schema.Struct<{
        readonly prefs: Schema.StructWithRest<Schema.Struct<{
            readonly allow: Schema.$Array<Schema.String>;
            readonly forward: Schema.$Array<Schema.String>;
            readonly log: Schema.Boolean;
            readonly model: Schema.StructWithRest<Schema.Struct<{
                readonly body: Schema.compose<Schema.Literals<readonly ["never", "summary", "full"]>, Schema.String>;
                readonly jev: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
                    readonly judgment: Schema.String;
                    readonly laterBp: Schema.Int;
                    readonly nowBp: Schema.Int;
                }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
                readonly kind: Schema.compose<Schema.Literals<readonly ["none", "jev", "service"]>, Schema.String>;
                readonly service: Schema.optionalKey<Schema.String>;
                readonly timeoutMs: Schema.Int;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
            readonly mute: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
                readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#thread">;
                readonly thread: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
                readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#group">;
                readonly group: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
            readonly refuse: Schema.$Array<Schema.String>;
            readonly version: Schema.compose<Schema.Literal<"0.1">, Schema.String>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly outputEncoding: "application/json";
    readonly params: Schema.Undefined;
    readonly path: "/xrpc/sh.mschf.ratking.attention.putPreferences";
};
