import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.agent.profile">;
    readonly birthContext: Schema.StructWithRest<Schema.Struct<{
        readonly createdAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
        readonly operator: Schema.String;
        readonly project: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly callSign: Schema.optionalKey<Schema.String>;
    readonly emoji: Schema.optionalKey<Schema.String>;
    readonly genesisCid: Schema.brand<Schema.String, "Lexicon:cid">;
    readonly icon: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"blob">;
        readonly mimeType: Schema.String;
        readonly ref: Schema.decodeTo<Schema.declare<import("@atproto/lex-data").Cid<0 | 1, number, number>, import("@atproto/lex-data").Cid<0 | 1, number, number>>, Schema.StructWithRest<Schema.Struct<{
            readonly $link: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.String>]>, never, never>;
        readonly size: Schema.Int;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly themeRef: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
    readonly updatedAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.agent.profile";
    readonly key: "tid";
};
