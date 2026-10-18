import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.attention.status">;
    readonly delegate: Schema.optionalKey<Schema.String>;
    readonly exempt: Schema.optionalKey<Schema.$Array<Schema.String>>;
    readonly note: Schema.optionalKey<Schema.String>;
    readonly state: Schema.compose<Schema.Literals<readonly ["available", "busy", "dnd"]>, Schema.String>;
    readonly until: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
    readonly version: Schema.compose<Schema.Literal<"0.1">, Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.attention.status";
    readonly key: "literal:self";
};
