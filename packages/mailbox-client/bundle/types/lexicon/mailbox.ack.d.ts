import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Params: Schema.Undefined;
export type ParamsValue = typeof Params.Type;
export declare const Input: Schema.StructWithRest<Schema.Struct<{
    readonly generation: Schema.Int;
    readonly leaseId: Schema.brand<Schema.String, "Lexicon:tid">;
    readonly message: Schema.StructWithRest<Schema.Struct<{
        readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
        readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
        readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
        readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type InputValue = typeof Input.Type;
export declare const Output: Schema.StructWithRest<Schema.Struct<{
    readonly receipt: Schema.StructWithRest<Schema.Struct<{
        readonly detail: Schema.optionalKey<Schema.String>;
        readonly message: Schema.StructWithRest<Schema.Struct<{
            readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
            readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
            readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
            readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
        readonly recordedAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
        readonly seq: Schema.Int;
        readonly state: Schema.String;
        readonly wakeReason: Schema.optionalKey<Schema.String>;
        readonly woke: Schema.optionalKey<Schema.Boolean>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type OutputValue = typeof Output.Type;
export declare const ErrorBody: Schema.StructWithRest<Schema.Struct<{
    readonly error: Schema.String;
    readonly message: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ErrorBodyValue = typeof ErrorBody.Type;
export declare const KnownErrors: readonly ["InvalidRequest", "AuthRequired", "Forbidden", "MessageNotFound", "LeaseMismatch", "InvalidTransition"];
export type KnownError = (typeof KnownErrors)[number];
export declare const isKnownError: (value: string) => value is KnownError;
export declare const Method: {
    readonly defaults: {};
    readonly error: Schema.StructWithRest<Schema.Struct<{
        readonly error: Schema.String;
        readonly message: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly input: Schema.StructWithRest<Schema.Struct<{
        readonly generation: Schema.Int;
        readonly leaseId: Schema.brand<Schema.String, "Lexicon:tid">;
        readonly message: Schema.StructWithRest<Schema.Struct<{
            readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
            readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
            readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
            readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly inputEncoding: "application/json";
    readonly method: "POST";
    readonly nsid: "sh.mschf.ratking.mailbox.ack";
    readonly output: Schema.StructWithRest<Schema.Struct<{
        readonly receipt: Schema.StructWithRest<Schema.Struct<{
            readonly detail: Schema.optionalKey<Schema.String>;
            readonly message: Schema.StructWithRest<Schema.Struct<{
                readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
                readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
                readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
                readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
            readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
            readonly recordedAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
            readonly seq: Schema.Int;
            readonly state: Schema.String;
            readonly wakeReason: Schema.optionalKey<Schema.String>;
            readonly woke: Schema.optionalKey<Schema.Boolean>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly outputEncoding: "application/json";
    readonly params: Schema.Undefined;
    readonly path: "/xrpc/sh.mschf.ratking.mailbox.ack";
};
