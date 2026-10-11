import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Guess: Schema.StructWithRest<Schema.Struct<{
    readonly model: Schema.String;
    readonly packets: Schema.Finite;
    readonly thinking: Schema.compose<Schema.Literals<readonly ["off", "minimal", "low", "medium", "high", "xhigh"]>, Schema.String>;
    readonly workType: Schema.compose<Schema.Literals<readonly ["bugfix", "refactor", "investigation", "scan", "gather", "ui", "feature"]>, Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type GuessValue = typeof Guess.Type;
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.agentgraph.checkin">;
    readonly brief: Schema.NullOr<Schema.String>;
    readonly briefMachine: Schema.String;
    readonly cleanup: Schema.optionalKey<Schema.$Array<Schema.String>>;
    readonly critical: Schema.Boolean;
    readonly goal: Schema.String;
    readonly guess: Schema.StructWithRest<Schema.Struct<{
        readonly model: Schema.String;
        readonly packets: Schema.Finite;
        readonly thinking: Schema.compose<Schema.Literals<readonly ["off", "minimal", "low", "medium", "high", "xhigh"]>, Schema.String>;
        readonly workType: Schema.compose<Schema.Literals<readonly ["bugfix", "refactor", "investigation", "scan", "gather", "ui", "feature"]>, Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly mode: Schema.compose<Schema.Literals<readonly ["ask", "fyi"]>, Schema.String>;
    readonly note: Schema.optionalKey<Schema.String>;
    readonly project: Schema.String;
    readonly repo: Schema.String;
    readonly row: Schema.NullOr<Schema.String>;
    readonly supersedes: Schema.optionalKey<Schema.String>;
    readonly version: Schema.compose<Schema.Literals<readonly ["0.1"]>, Schema.String>;
    readonly writeScope: Schema.$Array<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.agentgraph.checkin";
    readonly key: "tid";
};
