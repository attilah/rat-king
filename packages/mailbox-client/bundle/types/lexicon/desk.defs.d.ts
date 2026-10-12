import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const ByteSlice: Schema.StructWithRest<Schema.Struct<{
    readonly byteEnd: Schema.Int;
    readonly byteStart: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ByteSliceValue = typeof ByteSlice.Type;
export declare const Facet: Schema.StructWithRest<Schema.Struct<{
    readonly features: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.Literal<"sh.mschf.ratking.desk.defs#mention">;
        readonly did: Schema.brand<Schema.String, "Lexicon:did">;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
        readonly $type: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
    readonly index: Schema.StructWithRest<Schema.Struct<{
        readonly byteEnd: Schema.Int;
        readonly byteStart: Schema.Int;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type FacetValue = typeof Facet.Type;
export declare const Mention: Schema.StructWithRest<Schema.Struct<{
    readonly did: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MentionValue = typeof Mention.Type;
export declare const StrongRef: Schema.StructWithRest<Schema.Struct<{
    readonly cid: Schema.String;
    readonly uri: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type StrongRefValue = typeof StrongRef.Type;
export declare const ReplyRef: Schema.StructWithRest<Schema.Struct<{
    readonly parent: Schema.StructWithRest<Schema.Struct<{
        readonly cid: Schema.String;
        readonly uri: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly root: Schema.StructWithRest<Schema.Struct<{
        readonly cid: Schema.String;
        readonly uri: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ReplyRefValue = typeof ReplyRef.Type;
export declare const OwnerItem: Schema.StructWithRest<Schema.Struct<{
    readonly author: Schema.brand<Schema.String, "Lexicon:did">;
    readonly cid: Schema.String;
    readonly createdAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly facets: Schema.optionalKey<Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly features: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
            readonly $type: Schema.Literal<"sh.mschf.ratking.desk.defs#mention">;
            readonly did: Schema.brand<Schema.String, "Lexicon:did">;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
            readonly $type: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
        readonly index: Schema.StructWithRest<Schema.Struct<{
            readonly byteEnd: Schema.Int;
            readonly byteStart: Schema.Int;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>>;
    readonly kind: Schema.compose<Schema.Literals<readonly ["fyi", "progress", "done", "question", "blocked", "action"]>, Schema.String>;
    readonly lane: Schema.optionalKey<Schema.String>;
    readonly project: Schema.optionalKey<Schema.String>;
    readonly refs: Schema.optionalKey<Schema.$Array<Schema.String>>;
    readonly reply: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
        readonly parent: Schema.StructWithRest<Schema.Struct<{
            readonly cid: Schema.String;
            readonly uri: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly root: Schema.StructWithRest<Schema.Struct<{
            readonly cid: Schema.String;
            readonly uri: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly text: Schema.String;
    readonly uri: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type OwnerItemValue = typeof OwnerItem.Type;
export declare const Queued: Schema.StructWithRest<Schema.Struct<{
    readonly item: Schema.StructWithRest<Schema.Struct<{
        readonly author: Schema.brand<Schema.String, "Lexicon:did">;
        readonly cid: Schema.String;
        readonly createdAt: Schema.brand<Schema.String, "Lexicon:datetime">;
        readonly facets: Schema.optionalKey<Schema.$Array<Schema.StructWithRest<Schema.Struct<{
            readonly features: Schema.$Array<Schema.Union<readonly [Schema.StructWithRest<Schema.Struct<{
                readonly $type: Schema.Literal<"sh.mschf.ratking.desk.defs#mention">;
                readonly did: Schema.brand<Schema.String, "Lexicon:did">;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>, Schema.StructWithRest<Schema.Struct<{
                readonly $type: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>]>>;
            readonly index: Schema.StructWithRest<Schema.Struct<{
                readonly byteEnd: Schema.Int;
                readonly byteStart: Schema.Int;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>>;
        readonly kind: Schema.compose<Schema.Literals<readonly ["fyi", "progress", "done", "question", "blocked", "action"]>, Schema.String>;
        readonly lane: Schema.optionalKey<Schema.String>;
        readonly project: Schema.optionalKey<Schema.String>;
        readonly refs: Schema.optionalKey<Schema.$Array<Schema.String>>;
        readonly reply: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
            readonly parent: Schema.StructWithRest<Schema.Struct<{
                readonly cid: Schema.String;
                readonly uri: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
            readonly root: Schema.StructWithRest<Schema.Struct<{
                readonly cid: Schema.String;
                readonly uri: Schema.String;
            }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
        readonly text: Schema.String;
        readonly uri: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly seq: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type QueuedValue = typeof Queued.Type;
