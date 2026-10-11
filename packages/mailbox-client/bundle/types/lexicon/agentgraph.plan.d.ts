import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const CleanupItem: Schema.StructWithRest<Schema.Struct<{
    readonly owner: Schema.String;
    readonly what: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type CleanupItemValue = typeof CleanupItem.Type;
export declare const PacketsItem: Schema.StructWithRest<Schema.Struct<{
    readonly gates: Schema.$Array<Schema.String>;
    readonly model: Schema.String;
    readonly order: Schema.Finite;
    readonly parallelWith: Schema.$Array<Schema.Finite>;
    readonly thinking: Schema.compose<Schema.Literals<readonly ["off", "minimal", "low", "medium", "high", "xhigh"]>, Schema.String>;
    readonly workType: Schema.compose<Schema.Literals<readonly ["bugfix", "refactor", "investigation", "scan", "gather", "ui", "feature"]>, Schema.String>;
    readonly writeScope: Schema.$Array<Schema.String>;
    readonly writer: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type PacketsItemValue = typeof PacketsItem.Type;
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.agentgraph.plan">;
    readonly checkIn: Schema.String;
    readonly cleanup: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly owner: Schema.String;
        readonly what: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly constraints: Schema.$Array<Schema.String>;
    readonly packets: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly gates: Schema.$Array<Schema.String>;
        readonly model: Schema.String;
        readonly order: Schema.Finite;
        readonly parallelWith: Schema.$Array<Schema.Finite>;
        readonly thinking: Schema.compose<Schema.Literals<readonly ["off", "minimal", "low", "medium", "high", "xhigh"]>, Schema.String>;
        readonly workType: Schema.compose<Schema.Literals<readonly ["bugfix", "refactor", "investigation", "scan", "gather", "ui", "feature"]>, Schema.String>;
        readonly writeScope: Schema.$Array<Schema.String>;
        readonly writer: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly releaseWhen: Schema.optionalKey<Schema.String>;
    readonly verdict: Schema.compose<Schema.Literals<readonly ["go-as-proposed", "go-with-changes", "hold"]>, Schema.String>;
    readonly version: Schema.compose<Schema.Literals<readonly ["0.2"]>, Schema.String>;
    readonly why: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.agentgraph.plan";
    readonly key: "tid";
};
