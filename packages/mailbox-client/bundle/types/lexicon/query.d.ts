import { Schema } from "effect";
export declare const BooleanFromQuery: Schema.decodeTo<Schema.Boolean, Schema.Literals<readonly ["true", "false"]>, never, never>;
export declare const Value: Schema.Union<readonly [Schema.String, Schema.$Array<Schema.String>]>;
export declare const Params: Schema.$Record<Schema.String, Schema.Union<readonly [Schema.String, Schema.$Array<Schema.String>]>>;
export declare const entries: (params: typeof Params.Type) => readonly (readonly [string, string])[];
export declare const parameters: (pairs: readonly (readonly [string, string])[]) => {
    [k: string]: string | readonly string[];
};
