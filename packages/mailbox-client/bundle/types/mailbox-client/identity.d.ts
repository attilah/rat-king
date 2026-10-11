import { Schema } from "effect";
export declare const PrivateJwk: Schema.Struct<{
    readonly crv: Schema.Literal<"P-256">;
    readonly d: Schema.String;
    readonly kty: Schema.Literal<"EC">;
    readonly x: Schema.String;
    readonly y: Schema.String;
}>;
export declare const Identity: Schema.Struct<{
    readonly agreement: Schema.Struct<{
        readonly crv: Schema.Literal<"P-256">;
        readonly d: Schema.String;
        readonly kty: Schema.Literal<"EC">;
        readonly x: Schema.String;
        readonly y: Schema.String;
    }>;
    readonly did: Schema.String;
    readonly signing: Schema.Struct<{
        readonly crv: Schema.Literal<"P-256">;
        readonly d: Schema.String;
        readonly kty: Schema.Literal<"EC">;
        readonly x: Schema.String;
        readonly y: Schema.String;
    }>;
}>;
export type IdentityValue = typeof Identity.Type;
export declare const importSigning: (identity: IdentityValue) => import("effect/Effect").Effect<CryptoKey, import("../envelope/envelope.js").EnvelopeFailure, never>;
export declare const importAgreement: (identity: IdentityValue) => import("effect/Effect").Effect<CryptoKey, import("../envelope/envelope.js").EnvelopeFailure, never>;
