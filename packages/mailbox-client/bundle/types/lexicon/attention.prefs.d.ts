import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Name: Schema.String;
export type NameValue = typeof Name.Type;
export declare const Digest: Schema.StructWithRest<Schema.Struct<{
    readonly minutes: Schema.Int;
    readonly name: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type DigestValue = typeof Digest.Type;
export declare const Group: Schema.StructWithRest<Schema.Struct<{
    readonly group: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type GroupValue = typeof Group.Type;
export declare const Jev: Schema.StructWithRest<Schema.Struct<{
    readonly judgment: Schema.String;
    readonly laterBp: Schema.Int;
    readonly nowBp: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type JevValue = typeof Jev.Type;
export declare const Model: Schema.StructWithRest<Schema.Struct<{
    readonly body: Schema.compose<Schema.Literals<readonly ["never", "summary", "full"]>, Schema.String>;
    readonly jev: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
        readonly judgment: Schema.String;
        readonly laterBp: Schema.Int;
        readonly nowBp: Schema.Int;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly kind: Schema.compose<Schema.Literals<readonly ["none", "jev", "service"]>, Schema.String>;
    readonly service: Schema.optionalKey<Schema.String>;
    readonly timeoutMs: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ModelValue = typeof Model.Type;
export declare const Match: Schema.StructWithRest<Schema.Struct<{
    readonly from: Schema.optionalKey<Schema.String>;
    readonly project: Schema.optionalKey<Schema.String>;
    readonly type: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MatchValue = typeof Match.Type;
export declare const Rule: Schema.StructWithRest<Schema.Struct<{
    readonly id: Schema.String;
    readonly match: Schema.StructWithRest<Schema.Struct<{
        readonly from: Schema.optionalKey<Schema.String>;
        readonly project: Schema.optionalKey<Schema.String>;
        readonly type: Schema.optionalKey<Schema.String>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly minutes: Schema.optionalKey<Schema.Int>;
    readonly note: Schema.optionalKey<Schema.String>;
    readonly route: Schema.compose<Schema.Literals<readonly ["wake", "quiet", "digest", "hide"]>, Schema.String>;
    readonly until: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type RuleValue = typeof Rule.Type;
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly allow: Schema.$Array<Schema.String>;
    readonly digest: Schema.optionalKey<Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly minutes: Schema.Int;
        readonly name: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>>;
    readonly forward: Schema.$Array<Schema.String>;
    readonly log: Schema.Boolean;
    readonly model: Schema.StructWithRest<Schema.Struct<{
        readonly body: Schema.compose<Schema.Literals<readonly ["never", "summary", "full"]>, Schema.String>;
        readonly jev: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
            readonly judgment: Schema.String;
            readonly laterBp: Schema.Int;
            readonly nowBp: Schema.Int;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
        readonly kind: Schema.compose<Schema.Literals<readonly ["none", "jev", "service"]>, Schema.String>;
        readonly service: Schema.optionalKey<Schema.String>;
        readonly timeoutMs: Schema.Int;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly mute: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#thread">;
        readonly thread: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.attention.prefs#group">;
        readonly group: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
    readonly refuse: Schema.$Array<Schema.String>;
    readonly rules: Schema.optionalKey<Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly id: Schema.String;
        readonly match: Schema.StructWithRest<Schema.Struct<{
            readonly from: Schema.optionalKey<Schema.String>;
            readonly project: Schema.optionalKey<Schema.String>;
            readonly type: Schema.optionalKey<Schema.String>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly minutes: Schema.optionalKey<Schema.Int>;
        readonly note: Schema.optionalKey<Schema.String>;
        readonly route: Schema.compose<Schema.Literals<readonly ["wake", "quiet", "digest", "hide"]>, Schema.String>;
        readonly until: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>>;
    readonly version: Schema.compose<Schema.Literal<"0.1">, Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const Thread: Schema.StructWithRest<Schema.Struct<{
    readonly thread: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ThreadValue = typeof Thread.Type;
