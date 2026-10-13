import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.triage.judge">;
    readonly arrivalId: Schema.String;
    readonly body: Schema.optionalKey<Schema.String>;
    readonly cc: Schema.$Array<Schema.String>;
    readonly from: Schema.String;
    readonly intent: Schema.compose<Schema.Literals<readonly ["to", "cc", "ask", "reply"]>, Schema.String>;
    readonly kind: Schema.String;
    readonly recordType: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:nsid">>;
    readonly sentAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly thread: Schema.String;
    readonly to: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.triage.judge";
    readonly key: "any";
};
