import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Params: Schema.Undefined;
export type ParamsValue = typeof Params.Type;
export declare const Input: Schema.StructWithRest<Schema.Struct<{
    readonly desk: Schema.brand<Schema.String, "Lexicon:did">;
    readonly item: Schema.StructWithRest<Schema.Struct<{
        readonly author: Schema.brand<Schema.String, "Lexicon:did">;
        readonly cid: Schema.String;
        readonly createdAt: Schema.brand<Schema.String, "Lexicon:datetime">;
        readonly facets: Schema.optionalKey<Schema.$Array<Schema.StructWithRest<Schema.Struct<{
            readonly features: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
                readonly $type: Schema.Literal<"sh.mschf.ratking.desk.defs#mention">;
                readonly did: Schema.brand<Schema.String, "Lexicon:did">;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
                readonly $type: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
            readonly index: Schema.StructWithRest<Schema.Struct<{
                readonly byteEnd: Schema.Int;
                readonly byteStart: Schema.Int;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>>;
        readonly kind: Schema.compose<Schema.Literals<readonly ["fyi", "progress", "done", "question", "blocked", "action"]>, Schema.String>;
        readonly lane: Schema.optionalKey<Schema.String>;
        readonly project: Schema.optionalKey<Schema.String>;
        readonly refs: Schema.optionalKey<Schema.$Array<Schema.String>>;
        readonly reply: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
            readonly parent: Schema.StructWithRest<Schema.Struct<{
                readonly cid: Schema.String;
                readonly uri: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
            readonly root: Schema.StructWithRest<Schema.Struct<{
                readonly cid: Schema.String;
                readonly uri: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
        readonly text: Schema.String;
        readonly uri: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type InputValue = typeof Input.Type;
export declare const Output: Schema.StructWithRest<Schema.Struct<{
    readonly seq: Schema.Int;
    readonly stored: Schema.Boolean;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type OutputValue = typeof Output.Type;
export declare const ErrorBody: Schema.StructWithRest<Schema.Struct<{
    readonly error: Schema.String;
    readonly message: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ErrorBodyValue = typeof ErrorBody.Type;
export declare const KnownErrors: readonly ["InvalidRequest", "AuthRequired", "Forbidden", "CidInvalid", "CidConflict", "ProjectMismatch", "MailboxUnavailable"];
export type KnownError = (typeof KnownErrors)[number];
export declare const isKnownError: (value: string) => value is KnownError;
export declare const Method: {
    readonly defaults: {};
    readonly error: Schema.StructWithRest<Schema.Struct<{
        readonly error: Schema.String;
        readonly message: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly input: Schema.StructWithRest<Schema.Struct<{
        readonly desk: Schema.brand<Schema.String, "Lexicon:did">;
        readonly item: Schema.StructWithRest<Schema.Struct<{
            readonly author: Schema.brand<Schema.String, "Lexicon:did">;
            readonly cid: Schema.String;
            readonly createdAt: Schema.brand<Schema.String, "Lexicon:datetime">;
            readonly facets: Schema.optionalKey<Schema.$Array<Schema.StructWithRest<Schema.Struct<{
                readonly features: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
                    readonly $type: Schema.Literal<"sh.mschf.ratking.desk.defs#mention">;
                    readonly did: Schema.brand<Schema.String, "Lexicon:did">;
                }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
                    readonly $type: Schema.String;
                }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
                readonly index: Schema.StructWithRest<Schema.Struct<{
                    readonly byteEnd: Schema.Int;
                    readonly byteStart: Schema.Int;
                }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>>;
            readonly kind: Schema.compose<Schema.Literals<readonly ["fyi", "progress", "done", "question", "blocked", "action"]>, Schema.String>;
            readonly lane: Schema.optionalKey<Schema.String>;
            readonly project: Schema.optionalKey<Schema.String>;
            readonly refs: Schema.optionalKey<Schema.$Array<Schema.String>>;
            readonly reply: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
                readonly parent: Schema.StructWithRest<Schema.Struct<{
                    readonly cid: Schema.String;
                    readonly uri: Schema.String;
                }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
                readonly root: Schema.StructWithRest<Schema.Struct<{
                    readonly cid: Schema.String;
                    readonly uri: Schema.String;
                }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
            readonly text: Schema.String;
            readonly uri: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly inputEncoding: "application/json";
    readonly method: "POST";
    readonly nsid: "sh.mschf.ratking.desk.ingest";
    readonly output: Schema.StructWithRest<Schema.Struct<{
        readonly seq: Schema.Int;
        readonly stored: Schema.Boolean;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly outputEncoding: "application/json";
    readonly params: Schema.Undefined;
    readonly path: "/xrpc/sh.mschf.ratking.desk.ingest";
};
