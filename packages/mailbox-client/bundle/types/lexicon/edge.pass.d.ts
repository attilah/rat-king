import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.ratking.pass">;
    readonly desk: Schema.String;
    readonly deskDid: Schema.brand<Schema.String, "Lexicon:did">;
    readonly exp: Schema.Int;
    readonly iat: Schema.Int;
    readonly nonce: Schema.String;
    readonly run: Schema.String;
    readonly scope: Schema.$Array<Schema.String>;
    readonly v: Schema.Literal<1>;
    readonly worker: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.ratking.pass";
    readonly key: "tid";
};
