import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.attention.receipt">;
    readonly operation: Schema.compose<Schema.Literals<readonly ["putPreferences", "putStatus"]>, Schema.String>;
    readonly seq: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.attention.receipt";
    readonly key: "any";
};
