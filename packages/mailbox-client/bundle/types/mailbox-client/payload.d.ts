import { Effect, Schema } from "effect";
export declare const AgentName: Schema.String;
export declare const SUMMARY_MAX = 280;
export declare const SUMMARY_HARD_MAX = 400;
export declare const SUMMARY_WIRE_MAX = 280;
export declare const Kind: Schema.Literals<readonly ["message", "ask", "reply", "data"]>;
export type KindValue = typeof Kind.Type;
export declare const wakeIntent: (kind: KindValue | undefined, primary: boolean, quiet?: boolean, record?: boolean, copy?: boolean) => {
    wakeReason: "ask";
    woke: boolean;
} | {
    wakeReason: "data";
    woke: boolean;
} | {
    wakeReason: "quiet";
    woke: boolean;
} | {
    wakeReason: "cc";
    woke: boolean;
} | {
    wakeReason: "reply" | "to";
    woke: boolean;
};
export declare const ReplyRef: Schema.Struct<{
    readonly parent: Schema.String;
    readonly root: Schema.String;
}>;
export type ReplyRefValue = typeof ReplyRef.Type;
export declare const Payload: Schema.Struct<{
    readonly body: Schema.String;
    readonly cc: Schema.optionalKey<Schema.$Array<Schema.String>>;
    readonly from: Schema.String;
    readonly kind: Schema.optionalKey<Schema.Literals<readonly ["message", "ask", "reply", "data"]>>;
    readonly label: Schema.optionalKey<Schema.String>;
    readonly quiet: Schema.optionalKey<Schema.Literal<true>>;
    readonly reply: Schema.optionalKey<Schema.Struct<{
        readonly parent: Schema.String;
        readonly root: Schema.String;
    }>>;
    readonly replyTo: Schema.optionalKey<Schema.String>;
    readonly summary: Schema.optionalKey<Schema.String>;
    readonly thread: Schema.optionalKey<Schema.String>;
    readonly to: Schema.optionalKey<Schema.String>;
}>;
export type PayloadValue = typeof Payload.Type;
export declare const PayloadJson: Schema.fromJsonString<Schema.Struct<{
    readonly body: Schema.String;
    readonly cc: Schema.optionalKey<Schema.$Array<Schema.String>>;
    readonly from: Schema.String;
    readonly kind: Schema.optionalKey<Schema.Literals<readonly ["message", "ask", "reply", "data"]>>;
    readonly label: Schema.optionalKey<Schema.String>;
    readonly quiet: Schema.optionalKey<Schema.Literal<true>>;
    readonly reply: Schema.optionalKey<Schema.Struct<{
        readonly parent: Schema.String;
        readonly root: Schema.String;
    }>>;
    readonly replyTo: Schema.optionalKey<Schema.String>;
    readonly summary: Schema.optionalKey<Schema.String>;
    readonly thread: Schema.optionalKey<Schema.String>;
    readonly to: Schema.optionalKey<Schema.String>;
}>>;
export declare const encodePayload: (payload: {
    readonly body: string;
    readonly cc?: readonly string[];
    readonly from: string;
    readonly kind?: "ask" | "data" | "message" | "reply";
    readonly label?: string;
    readonly quiet?: true;
    readonly reply?: {
        readonly parent: string;
        readonly root: string;
    };
    readonly replyTo?: string;
    readonly summary?: string;
    readonly thread?: string;
    readonly to?: string;
}) => Effect.Effect<string, Schema.SchemaError, never>;
