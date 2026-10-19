import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.ratking.ticket">;
    readonly did: Schema.brand<Schema.String, "Lexicon:did">;
    readonly exp: Schema.Int;
    readonly fingerprint: Schema.String;
    readonly iat: Schema.Int;
    readonly issuer: Schema.String;
    readonly name: Schema.String;
    readonly namespace: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.ratking.ticket";
    readonly key: "tid";
};
