import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.ratking.revocation">;
    readonly createdAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly invite: Schema.String;
    readonly issuer: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.ratking.revocation";
    readonly key: "tid";
};
