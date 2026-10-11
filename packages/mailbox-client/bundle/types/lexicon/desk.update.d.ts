import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.desk.update">;
    readonly itemId: Schema.String;
    readonly project: Schema.String;
    readonly state: Schema.compose<Schema.Literals<readonly ["resolved", "superseded", "followup"]>, Schema.String>;
    readonly text: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.desk.update";
    readonly key: "tid";
};
