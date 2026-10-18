import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Agree: Schema.StructWithRest<Schema.Struct<{
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["agree"]>, Schema.String>;
    readonly text: Schema.NullOr<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type AgreeValue = typeof Agree.Type;
export declare const Comment: Schema.StructWithRest<Schema.Struct<{
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["comment"]>, Schema.String>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type CommentValue = typeof Comment.Type;
export declare const Dispute: Schema.StructWithRest<Schema.Struct<{
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["dispute"]>, Schema.String>;
    readonly source: Schema.StructWithRest<Schema.Struct<{
        readonly host: Schema.String;
        readonly line: Schema.Int;
        readonly path: Schema.String;
        readonly quote: Schema.String;
        readonly sha256: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type DisputeValue = typeof Dispute.Type;
export declare const Duplicate: Schema.StructWithRest<Schema.Struct<{
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["duplicate"]>, Schema.String>;
    readonly of: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type DuplicateValue = typeof Duplicate.Type;
export declare const Evidence: Schema.StructWithRest<Schema.Struct<{
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["evidence"]>, Schema.String>;
    readonly source: Schema.NullOr<Schema.StructWithRest<Schema.Struct<{
        readonly host: Schema.String;
        readonly line: Schema.Int;
        readonly path: Schema.String;
        readonly quote: Schema.String;
        readonly sha256: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type EvidenceValue = typeof Evidence.Type;
export declare const Fixed: Schema.StructWithRest<Schema.Struct<{
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly commit: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["fixed"]>, Schema.String>;
    readonly repo: Schema.String;
    readonly text: Schema.NullOr<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type FixedValue = typeof Fixed.Type;
export declare const Main: Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.event">;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["agree"]>, Schema.String>;
    readonly text: Schema.NullOr<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.event">;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["dispute"]>, Schema.String>;
    readonly source: Schema.StructWithRest<Schema.Struct<{
        readonly host: Schema.String;
        readonly line: Schema.Int;
        readonly path: Schema.String;
        readonly quote: Schema.String;
        readonly sha256: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.event">;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["evidence"]>, Schema.String>;
    readonly source: Schema.NullOr<Schema.StructWithRest<Schema.Struct<{
        readonly host: Schema.String;
        readonly line: Schema.Int;
        readonly path: Schema.String;
        readonly quote: Schema.String;
        readonly sha256: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.event">;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["comment"]>, Schema.String>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.event">;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly commit: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["fixed"]>, Schema.String>;
    readonly repo: Schema.String;
    readonly text: Schema.NullOr<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.event">;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["wontfix"]>, Schema.String>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.event">;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["reopen"]>, Schema.String>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.event">;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["duplicate"]>, Schema.String>;
    readonly of: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.rulegarden.event";
    readonly key: "tid";
};
export declare const Reopen: Schema.StructWithRest<Schema.Struct<{
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["reopen"]>, Schema.String>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ReopenValue = typeof Reopen.Type;
export declare const Wontfix: Schema.StructWithRest<Schema.Struct<{
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly by: Schema.String;
    readonly findingId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["wontfix"]>, Schema.String>;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type WontfixValue = typeof Wontfix.Type;
