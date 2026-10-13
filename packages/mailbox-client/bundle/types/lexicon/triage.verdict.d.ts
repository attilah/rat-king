import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.triage.verdict">;
    readonly arrivalId: Schema.String;
    readonly modelId: Schema.String;
    readonly probabilityBp: Schema.Int;
    readonly reason: Schema.String;
    readonly verdict: Schema.compose<Schema.Literals<readonly ["Now", "Next", "Later", "Never"]>, Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.triage.verdict";
    readonly key: "any";
};
