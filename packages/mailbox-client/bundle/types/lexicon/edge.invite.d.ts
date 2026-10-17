import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.ratking.invite">;
    readonly allowFleetOutbound: Schema.Boolean;
    readonly createdAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly expiresAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly issuer: Schema.brand<Schema.String, "Lexicon:did">;
    readonly namespace: Schema.String;
    readonly ratePerMinute: Schema.Int;
    readonly recipients: Schema.$Array<Schema.String>;
    readonly subject: Schema.brand<Schema.String, "Lexicon:did">;
    readonly subjectKey: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.ratking.invite";
    readonly key: "tid";
};
