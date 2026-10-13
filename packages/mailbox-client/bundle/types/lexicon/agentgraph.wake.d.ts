import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.agentgraph.wake">;
    readonly code: Schema.optionalKey<Schema.String>;
    readonly failure: Schema.optionalKey<Schema.String>;
    readonly finishedAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly kind: Schema.compose<Schema.Literals<readonly ["agent_state", "pane_output", "ping"]>, Schema.String>;
    readonly label: Schema.String;
    readonly pane: Schema.optionalKey<Schema.String>;
    readonly result: Schema.optionalKey<Schema.String>;
    readonly source: Schema.compose<Schema.Literals<readonly ["herdr_watch", "herdr_ping_wait"]>, Schema.String>;
    readonly startedAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly status: Schema.compose<Schema.Literals<readonly ["matched", "timedOut", "targetGone", "failed", "cancelled"]>, Schema.String>;
    readonly target: Schema.optionalKey<Schema.String>;
    readonly targetPaneId: Schema.optionalKey<Schema.String>;
    readonly targetTerminalId: Schema.optionalKey<Schema.String>;
    readonly text: Schema.String;
    readonly watch: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.agentgraph.wake";
    readonly key: "tid";
};
