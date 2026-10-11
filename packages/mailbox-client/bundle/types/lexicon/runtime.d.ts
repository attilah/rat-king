import type { Cid as CidValue } from "@atproto/lex-data";
import type { LexString } from "@atproto/lexicon";
import { Schema } from "effect";
export type LexValue = null | boolean | number | string | Uint8Array | CidValue | readonly LexValue[] | LexMap;
export interface LexMap {
    readonly [key: string]: LexValue;
}
export type LexJson = null | boolean | number | string | readonly LexJson[] | LexJsonMap;
export interface LexJsonMap {
    readonly [key: string]: LexJson;
}
export declare const Cid: Schema.declare<CidValue<0 | 1, number, number>, CidValue<0 | 1, number, number>>;
export declare const Link: Schema.decodeTo<Schema.declare<CidValue<0 | 1, number, number>, CidValue<0 | 1, number, number>>, Schema.StructWithRest<Schema.Struct<{
    readonly $link: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.String>]>, never, never>;
export declare const Bytes: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
    readonly $bytes: Schema.Uint8ArrayFromBase64;
}>, Schema.StructWithRest<Schema.Struct<{
    readonly $bytes: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
export declare const Data: Schema.Codec<LexValue, LexJson>;
export declare const DataMap: Schema.$Record<Schema.String, Schema.Codec<LexValue, LexJson, never, never>>;
export declare const TaggedMap: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<LexValue, LexJson, never, never>>]>;
export declare const lexString: (definition: LexString) => Schema.String;
export declare const Blob: Schema.StructWithRest<Schema.Struct<{
    readonly $type: Schema.Literal<"blob">;
    readonly mimeType: Schema.String;
    readonly ref: Schema.decodeTo<Schema.declare<CidValue<0 | 1, number, number>, CidValue<0 | 1, number, number>>, Schema.StructWithRest<Schema.Struct<{
        readonly $link: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.String>]>, never, never>;
    readonly size: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<LexValue, LexJson, never, never>>]>;
export declare const XrpcErrorBody: Schema.StructWithRest<Schema.Struct<{
    readonly error: Schema.String;
    readonly message: Schema.optionalKey<Schema.String>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<LexValue, LexJson, never, never>>]>;
