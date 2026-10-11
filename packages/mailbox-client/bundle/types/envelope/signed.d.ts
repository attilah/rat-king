import { Effect, Schema } from "effect";
import { EnvelopeFailure } from "./failure.js";
export type ResolveSigningKey = (senderDid: string, keyId: string) => Effect.Effect<CryptoKey, EnvelopeFailure>;
export declare const verifySigned: (envelope: {
    readonly [x: string]: import("../lexicon/runtime.js").LexValue;
    readonly aad: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly expiresAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
        readonly messageId: string & import("effect/Brand").Brand<"Lexicon:tid">;
        readonly recipientDid: string & import("effect/Brand").Brand<"Lexicon:did">;
        readonly recipientKeyId: string & import("effect/Brand").Brand<"Lexicon:uri">;
        readonly senderDid: string & import("effect/Brand").Brand<"Lexicon:did">;
    };
    readonly ciphertext: Uint8Array<ArrayBufferLike>;
    readonly enc: Uint8Array<ArrayBufferLike>;
    readonly suite: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly aeadId: number;
        readonly kdfId: number;
        readonly kemId: number;
    };
    readonly version: number;
}, signedBytes: Uint8Array<ArrayBufferLike>, resolveSigningKey: ResolveSigningKey) => Effect.Effect<{
    readonly [x: string]: import("../lexicon/runtime.js").LexValue;
    readonly aad: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly expiresAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
        readonly messageId: string & import("effect/Brand").Brand<"Lexicon:tid">;
        readonly recipientDid: string & import("effect/Brand").Brand<"Lexicon:did">;
        readonly recipientKeyId: string & import("effect/Brand").Brand<"Lexicon:uri">;
        readonly senderDid: string & import("effect/Brand").Brand<"Lexicon:did">;
    };
    readonly body: Uint8Array<ArrayBufferLike>;
    readonly createdAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
    readonly replyTo?: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly cid?: string & import("effect/Brand").Brand<"Lexicon:cid">;
        readonly messageId: string & import("effect/Brand").Brand<"Lexicon:tid">;
        readonly senderDid: string & import("effect/Brand").Brand<"Lexicon:did">;
        readonly uri?: string & import("effect/Brand").Brand<"Lexicon:at-uri">;
    };
    readonly suite: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly aeadId: number;
        readonly kdfId: number;
        readonly kemId: number;
    };
    readonly urgent?: true;
    readonly version: number;
}, EnvelopeFailure | Schema.SchemaError, never>;
export declare const openPlaintext: (envelope: {
    readonly [x: string]: import("../lexicon/runtime.js").LexValue;
    readonly aad: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly expiresAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
        readonly messageId: string & import("effect/Brand").Brand<"Lexicon:tid">;
        readonly recipientDid: string & import("effect/Brand").Brand<"Lexicon:did">;
        readonly recipientKeyId: string & import("effect/Brand").Brand<"Lexicon:uri">;
        readonly senderDid: string & import("effect/Brand").Brand<"Lexicon:did">;
    };
    readonly ciphertext: Uint8Array<ArrayBufferLike>;
    readonly enc: Uint8Array<ArrayBufferLike>;
    readonly suite: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly aeadId: number;
        readonly kdfId: number;
        readonly kemId: number;
    };
    readonly version: number;
}, resolveSigningKey: ResolveSigningKey) => Effect.Effect<{
    readonly [x: string]: import("../lexicon/runtime.js").LexValue;
    readonly aad: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly expiresAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
        readonly messageId: string & import("effect/Brand").Brand<"Lexicon:tid">;
        readonly recipientDid: string & import("effect/Brand").Brand<"Lexicon:did">;
        readonly recipientKeyId: string & import("effect/Brand").Brand<"Lexicon:uri">;
        readonly senderDid: string & import("effect/Brand").Brand<"Lexicon:did">;
    };
    readonly body: Uint8Array<ArrayBufferLike>;
    readonly createdAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
    readonly replyTo?: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly cid?: string & import("effect/Brand").Brand<"Lexicon:cid">;
        readonly messageId: string & import("effect/Brand").Brand<"Lexicon:tid">;
        readonly senderDid: string & import("effect/Brand").Brand<"Lexicon:did">;
        readonly uri?: string & import("effect/Brand").Brand<"Lexicon:at-uri">;
    };
    readonly suite: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly aeadId: number;
        readonly kdfId: number;
        readonly kemId: number;
    };
    readonly urgent?: true;
    readonly version: number;
}, EnvelopeFailure | Schema.SchemaError, never>;
export declare const plaintextBody: (envelope: {
    readonly [x: string]: import("../lexicon/runtime.js").LexValue;
    readonly aad: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly expiresAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
        readonly messageId: string & import("effect/Brand").Brand<"Lexicon:tid">;
        readonly recipientDid: string & import("effect/Brand").Brand<"Lexicon:did">;
        readonly recipientKeyId: string & import("effect/Brand").Brand<"Lexicon:uri">;
        readonly senderDid: string & import("effect/Brand").Brand<"Lexicon:did">;
    };
    readonly ciphertext: Uint8Array<ArrayBufferLike>;
    readonly enc: Uint8Array<ArrayBufferLike>;
    readonly suite: {
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly aeadId: number;
        readonly kdfId: number;
        readonly kemId: number;
    };
    readonly version: number;
}) => Effect.Effect<string, EnvelopeFailure | Schema.SchemaError, never>;
