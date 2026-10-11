import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Option: Schema.StructWithRest<Schema.Struct<{
    readonly id: Schema.String;
    readonly label: Schema.String;
    readonly outcome: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type OptionValue = typeof Option.Type;
export declare const Choice: Schema.StructWithRest<Schema.Struct<{
    readonly key: Schema.String;
    readonly label: Schema.String;
    readonly options: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly id: Schema.String;
        readonly label: Schema.String;
        readonly outcome: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly suggest: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ChoiceValue = typeof Choice.Type;
export declare const Row: Schema.StructWithRest<Schema.Struct<{
    readonly label: Schema.String;
    readonly on: Schema.Boolean;
    readonly v: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type RowValue = typeof Row.Type;
export declare const Rows: Schema.StructWithRest<Schema.Struct<{
    readonly items: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly label: Schema.String;
        readonly on: Schema.Boolean;
        readonly v: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly key: Schema.String;
    readonly label: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type RowsValue = typeof Rows.Type;
export declare const Main: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"sh.mschf.ratking.desk.item">;
    readonly body: Schema.String;
    readonly choices: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly key: Schema.String;
        readonly label: Schema.String;
        readonly options: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
            readonly id: Schema.String;
            readonly label: Schema.String;
            readonly outcome: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
        readonly suggest: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly createdAt: Schema.brand<Schema.String, "Lexicon:datetime">;
    readonly itemId: Schema.String;
    readonly kind: Schema.compose<Schema.Literals<readonly ["decision", "approval", "blocked", "done", "fyi"]>, Schema.String>;
    readonly project: Schema.String;
    readonly refs: Schema.$Array<Schema.String>;
    readonly rows: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
        readonly items: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
            readonly label: Schema.String;
            readonly on: Schema.Boolean;
            readonly v: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
        readonly key: Schema.String;
        readonly label: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly supersedes: Schema.optionalKey<Schema.String>;
    readonly title: Schema.String;
    readonly why: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MainValue = typeof Main.Type;
export declare const RecordMetadata: {
    readonly collection: "sh.mschf.ratking.desk.item";
    readonly key: "tid";
};
