import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.agentgraph.outcome">;
    readonly checkIn: Schema.String;
    readonly gate: Schema.compose<Schema.Literals<readonly ["pass", "fail", "skip"]>, Schema.String>;
    readonly landedAs: Schema.optionalKey<Schema.String>;
    readonly outcome: Schema.compose<Schema.Literals<readonly ["committed", "rejected", "no_changes"]>, Schema.String>;
    readonly version: Schema.compose<Schema.Literals<readonly ["0.1"]>, Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.agentgraph.outcome";
    readonly key: "tid";
};
