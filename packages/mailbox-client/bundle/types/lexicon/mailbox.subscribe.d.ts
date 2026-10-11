import { Effect, Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Auth: Schema.StructWithRest<Schema.Struct<{
    readonly token: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type AuthValue = typeof Auth.Type;
export declare const Params: Schema.StructWithRest<Schema.Struct<{
    readonly generation: Schema.Int;
    readonly leaseId: Schema.brand<Schema.String, "Lexicon:tid">;
    readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ParamsValue = typeof Params.Type;
export declare const Message: Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.mailbox.subscribe#notice">;
    readonly seq: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>;
export type MessageValue = typeof Message.Type;
export declare const ParamsFromQuery: Schema.compose<Schema.StructWithRest<Schema.Struct<{
    readonly generation: Schema.Int;
    readonly leaseId: Schema.brand<Schema.String, "Lexicon:tid">;
    readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly generation: Schema.FiniteFromString;
    readonly leaseId: Schema.String;
    readonly recipientDid: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
export declare const encodeParams: (params: {
    readonly [x: string]: Runtime.LexValue;
    readonly generation: number;
    readonly leaseId: string & import("effect/Brand").Brand<"Lexicon:tid">;
    readonly recipientDid: string & import("effect/Brand").Brand<"Lexicon:did">;
}) => Effect.Effect<readonly (readonly [string, string])[], Schema.SchemaError, never>;
export declare const decodeParams: (entries: readonly (readonly [string, string])[]) => Effect.Effect<{
    readonly [x: string]: Runtime.LexValue;
    readonly generation: number;
    readonly leaseId: string & import("effect/Brand").Brand<"Lexicon:tid">;
    readonly recipientDid: string & import("effect/Brand").Brand<"Lexicon:did">;
}, Schema.SchemaError, never>;
export declare const KnownErrors: readonly ["AuthRequired", "Forbidden", "LeaseMismatch"];
export type KnownError = (typeof KnownErrors)[number];
export declare const isKnownError: (value: string) => value is KnownError;
export declare const Method: {
    readonly nsid: "sh.mschf.ratking.mailbox.subscribe";
    readonly params: Schema.StructWithRest<Schema.Struct<{
        readonly generation: Schema.Int;
        readonly leaseId: Schema.brand<Schema.String, "Lexicon:tid">;
        readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly path: "/xrpc/sh.mschf.ratking.mailbox.subscribe";
};
export declare const Notice: Schema.StructWithRest<Schema.Struct<{
    readonly seq: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type NoticeValue = typeof Notice.Type;
