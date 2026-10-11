import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Claude: Schema.StructWithRest<Schema.Struct<{
    readonly executionId: Schema.optionalKey<Schema.String>;
    readonly paneId: Schema.optionalKey<Schema.String>;
    readonly sessionId: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ClaudeValue = typeof Claude.Type;
export declare const Codex: Schema.StructWithRest<Schema.Struct<{
    readonly executionId: Schema.optionalKey<Schema.String>;
    readonly paneId: Schema.optionalKey<Schema.String>;
    readonly sessionId: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type CodexValue = typeof Codex.Type;
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly did: Schema.brand<Schema.String, "Lexicon:did">;
    readonly expiresAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly generation: Schema.Int;
    readonly harness: Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.runtime.lease#pi">;
        readonly executionId: Schema.optionalKey<Schema.String>;
        readonly paneId: Schema.optionalKey<Schema.String>;
        readonly sessionId: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.runtime.lease#claude">;
        readonly executionId: Schema.optionalKey<Schema.String>;
        readonly paneId: Schema.optionalKey<Schema.String>;
        readonly sessionId: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.runtime.lease#codex">;
        readonly executionId: Schema.optionalKey<Schema.String>;
        readonly paneId: Schema.optionalKey<Schema.String>;
        readonly sessionId: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.runtime.lease#opencode">;
        readonly executionId: Schema.optionalKey<Schema.String>;
        readonly paneId: Schema.optionalKey<Schema.String>;
        readonly sessionId: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.runtime.lease#other">;
        readonly executionId: Schema.optionalKey<Schema.String>;
        readonly kind: Schema.String;
        readonly paneId: Schema.optionalKey<Schema.String>;
        readonly sessionId: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>;
    readonly issuedAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
    readonly leaseId: Schema.brand<Schema.String, "Lexicon:tid">;
    readonly renders: Schema.optionalKey<Schema.$Array<Schema.String>>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const Opencode: Schema.StructWithRest<Schema.Struct<{
    readonly executionId: Schema.optionalKey<Schema.String>;
    readonly paneId: Schema.optionalKey<Schema.String>;
    readonly sessionId: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type OpencodeValue = typeof Opencode.Type;
export declare const Other: Schema.StructWithRest<Schema.Struct<{
    readonly executionId: Schema.optionalKey<Schema.String>;
    readonly kind: Schema.String;
    readonly paneId: Schema.optionalKey<Schema.String>;
    readonly sessionId: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type OtherValue = typeof Other.Type;
export declare const Pi: Schema.StructWithRest<Schema.Struct<{
    readonly executionId: Schema.optionalKey<Schema.String>;
    readonly paneId: Schema.optionalKey<Schema.String>;
    readonly sessionId: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type PiValue = typeof Pi.Type;
