import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.agentgraph.turn">;
    readonly agent: Schema.String;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly generation: Schema.optionalKey<Schema.Int>;
    readonly reason: Schema.optionalKey<Schema.String>;
    readonly session: Schema.String;
    readonly state: Schema.compose<Schema.Literals<readonly ["working", "done", "blocked", "idle", "crashed"]>, Schema.String>;
    readonly stopReason: Schema.optionalKey<Schema.compose<Schema.Literals<readonly ["stop", "aborted", "error", "length"]>, Schema.String>>;
    readonly turnId: Schema.String;
    readonly version: Schema.compose<Schema.Literals<readonly ["0.1"]>, Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.agentgraph.turn";
    readonly key: "tid";
};
