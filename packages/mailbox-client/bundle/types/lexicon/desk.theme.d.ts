import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.desk.theme">;
    readonly namePool: Schema.optionalKey<Schema.$Array<Schema.String>>;
    readonly tone: Schema.optionalKey<Schema.String>;
    readonly universe: Schema.String;
    readonly updatedAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.desk.theme";
    readonly key: "tid";
};
