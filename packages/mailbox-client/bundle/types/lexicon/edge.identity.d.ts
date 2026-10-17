import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const PublicKey: Schema.StructWithRest<Schema.Struct<{
    readonly crv: Schema.compose<Schema.Literal<"P-256">, Schema.String>;
    readonly kty: Schema.compose<Schema.Literal<"EC">, Schema.String>;
    readonly x: Schema.String;
    readonly y: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type PublicKeyValue = typeof PublicKey.Type;
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.ratking.identity">;
    readonly atprotoHandle: Schema.brand<Schema.String, "Lexicon:handle">;
    readonly audience: Schema.compose<Schema.Literal<"https://ratking.sh/mcp">, Schema.String>;
    readonly createdAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly expiresAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly handle: Schema.String;
    readonly publicKey: Schema.StructWithRest<Schema.Struct<{
        readonly crv: Schema.compose<Schema.Literal<"P-256">, Schema.String>;
        readonly kty: Schema.compose<Schema.Literal<"EC">, Schema.String>;
        readonly x: Schema.String;
        readonly y: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly subject: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.ratking.identity";
    readonly key: "tid";
};
