import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Quote: Schema.StructWithRest<Schema.Struct<{
    readonly source: Schema.String;
    readonly text: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type QuoteValue = typeof Quote.Type;
export declare const Source: Schema.StructWithRest<Schema.Struct<{
    readonly host: Schema.String;
    readonly line: Schema.Int;
    readonly path: Schema.String;
    readonly quote: Schema.String;
    readonly sha256: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type SourceValue = typeof Source.Type;
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.rulegarden.finding">;
    readonly action: Schema.compose<Schema.Literals<readonly ["adopt-principle", "delete", "replace", "narrow", "merge", "update", "sync-install"]>, Schema.String>;
    readonly at: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly bytesSaved: Schema.NullOr<Schema.Int>;
    readonly claim: Schema.String;
    readonly evidence: Schema.$Array<Schema.String>;
    readonly id: Schema.String;
    readonly joelQuote: Schema.NullOr<Schema.StructWithRest<Schema.Struct<{
        readonly source: Schema.String;
        readonly text: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly kind: Schema.compose<Schema.Literals<readonly ["principle", "contradiction", "bloat", "stale"]>, Schema.String>;
    readonly load: Schema.compose<Schema.Literals<readonly ["always", "skill-trigger", "on-demand"]>, Schema.String>;
    readonly owner: Schema.String;
    readonly peon: Schema.String;
    readonly principles: Schema.$Array<Schema.String>;
    readonly proposal: Schema.String;
    readonly severity: Schema.compose<Schema.Literals<readonly ["high", "medium", "low"]>, Schema.String>;
    readonly spans: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly host: Schema.String;
        readonly line: Schema.Int;
        readonly path: Schema.String;
        readonly quote: Schema.String;
        readonly sha256: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly staleRefs: Schema.$Array<Schema.String>;
    readonly wave: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.rulegarden.finding";
    readonly key: "tid";
};
