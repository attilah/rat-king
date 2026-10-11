import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.desk.answer">;
    readonly inReplyTo: Schema.brand<Schema.String, "Lexicon:tid">;
    readonly itemId: Schema.String;
    readonly note: Schema.optionalKey<Schema.String>;
    readonly project: Schema.String;
    readonly rows: Schema.optionalKey<Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>>;
    readonly values: Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.desk.answer";
    readonly key: "tid";
};
