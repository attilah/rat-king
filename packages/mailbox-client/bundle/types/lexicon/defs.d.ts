import { Schema } from "effect";
import * as Runtime from "./runtime.js";
export declare const Aad: Schema.StructWithRest<Schema.Struct<{
    readonly expiresAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
    readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
    readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
    readonly recipientKeyId: Schema.brand<Schema.String, "Lexicon:uri">;
    readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type AadValue = typeof Aad.Type;
export declare const AppSignature: Schema.StructWithRest<Schema.Struct<{
    readonly algorithm: Schema.String;
    readonly keyId: Schema.brand<Schema.String, "Lexicon:uri">;
    readonly publicKeyMultibase: Schema.optionalKey<Schema.String>;
    readonly signature: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
        readonly $bytes: Schema.Uint8ArrayFromBase64;
    }>, Schema.StructWithRest<Schema.Struct<{
        readonly $bytes: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type AppSignatureValue = typeof AppSignature.Type;
export declare const BirthContext: Schema.StructWithRest<Schema.Struct<{
    readonly createdAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
    readonly operator: Schema.String;
    readonly project: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type BirthContextValue = typeof BirthContext.Type;
export declare const DeliveryState: Schema.String;
export type DeliveryStateValue = typeof DeliveryState.Type;
export declare const DeliveryStateKnownValues: readonly ["accepted", "queued", "delivered", "acked", "expired", "failed"];
export type DeliveryStateKnown = (typeof DeliveryStateKnownValues)[number];
export declare const isDeliveryStateKnown: (value: DeliveryStateValue) => value is DeliveryStateKnown;
export declare const PublicJwk: Schema.StructWithRest<Schema.Struct<{
    readonly crv: Schema.compose<Schema.Literal<"P-256">, Schema.String>;
    readonly kty: Schema.compose<Schema.Literal<"EC">, Schema.String>;
    readonly x: Schema.String;
    readonly y: Schema.String;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type PublicJwkValue = typeof PublicJwk.Type;
export declare const DidVerificationMethod: Schema.StructWithRest<Schema.Struct<{
    readonly controller: Schema.String;
    readonly id: Schema.String;
    readonly publicKeyJwk: Schema.StructWithRest<Schema.Struct<{
        readonly crv: Schema.compose<Schema.Literal<"P-256">, Schema.String>;
        readonly kty: Schema.compose<Schema.Literal<"EC">, Schema.String>;
        readonly x: Schema.String;
        readonly y: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type DidVerificationMethodValue = typeof DidVerificationMethod.Type;
export declare const DidDocument: Schema.StructWithRest<Schema.Struct<{
    readonly authentication: Schema.$Array<Schema.String>;
    readonly id: Schema.brand<Schema.String, "Lexicon:did">;
    readonly keyAgreement: Schema.$Array<Schema.String>;
    readonly verificationMethod: Schema.$Array<Schema.StructWithRest<Schema.Struct<{
        readonly controller: Schema.String;
        readonly id: Schema.String;
        readonly publicKeyJwk: Schema.StructWithRest<Schema.Struct<{
            readonly crv: Schema.compose<Schema.Literal<"P-256">, Schema.String>;
            readonly kty: Schema.compose<Schema.Literal<"EC">, Schema.String>;
            readonly x: Schema.String;
            readonly y: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type DidDocumentValue = typeof DidDocument.Type;
export declare const HpkeSuite: Schema.StructWithRest<Schema.Struct<{
    readonly aeadId: Schema.Int;
    readonly kdfId: Schema.Int;
    readonly kemId: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type HpkeSuiteValue = typeof HpkeSuite.Type;
export declare const EncryptedEnvelope: Schema.StructWithRest<Schema.Struct<{
    readonly aad: Schema.StructWithRest<Schema.Struct<{
        readonly expiresAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
        readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
        readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
        readonly recipientKeyId: Schema.brand<Schema.String, "Lexicon:uri">;
        readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly ciphertext: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
        readonly $bytes: Schema.Uint8ArrayFromBase64;
    }>, Schema.StructWithRest<Schema.Struct<{
        readonly $bytes: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
    readonly enc: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
        readonly $bytes: Schema.Uint8ArrayFromBase64;
    }>, Schema.StructWithRest<Schema.Struct<{
        readonly $bytes: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
    readonly suite: Schema.StructWithRest<Schema.Struct<{
        readonly aeadId: Schema.Int;
        readonly kdfId: Schema.Int;
        readonly kemId: Schema.Int;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly version: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type EncryptedEnvelopeValue = typeof EncryptedEnvelope.Type;
export declare const MessageRef: Schema.StructWithRest<Schema.Struct<{
    readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
    readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
    readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
    readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MessageRefValue = typeof MessageRef.Type;
export declare const Receipt: Schema.StructWithRest<Schema.Struct<{
    readonly detail: Schema.optionalKey<Schema.String>;
    readonly message: Schema.StructWithRest<Schema.Struct<{
        readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
        readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
        readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
        readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
    readonly recordedAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
    readonly seq: Schema.Int;
    readonly state: Schema.String;
    readonly wakeReason: Schema.optionalKey<Schema.String>;
    readonly woke: Schema.optionalKey<Schema.Boolean>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ReceiptValue = typeof Receipt.Type;
export declare const MessageEvent: Schema.StructWithRest<Schema.Struct<{
    readonly envelope: Schema.StructWithRest<Schema.Struct<{
        readonly aad: Schema.StructWithRest<Schema.Struct<{
            readonly expiresAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
            readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
            readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
            readonly recipientKeyId: Schema.brand<Schema.String, "Lexicon:uri">;
            readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly ciphertext: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
            readonly $bytes: Schema.Uint8ArrayFromBase64;
        }>, Schema.StructWithRest<Schema.Struct<{
            readonly $bytes: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
        readonly enc: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
            readonly $bytes: Schema.Uint8ArrayFromBase64;
        }>, Schema.StructWithRest<Schema.Struct<{
            readonly $bytes: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
        readonly suite: Schema.StructWithRest<Schema.Struct<{
            readonly aeadId: Schema.Int;
            readonly kdfId: Schema.Int;
            readonly kemId: Schema.Int;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly version: Schema.Int;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly receipt: Schema.StructWithRest<Schema.Struct<{
        readonly detail: Schema.optionalKey<Schema.String>;
        readonly message: Schema.StructWithRest<Schema.Struct<{
            readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
            readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
            readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
            readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
        readonly recordedAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
        readonly seq: Schema.Int;
        readonly state: Schema.String;
        readonly wakeReason: Schema.optionalKey<Schema.String>;
        readonly woke: Schema.optionalKey<Schema.Boolean>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly seq: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type MessageEventValue = typeof MessageEvent.Type;
export declare const ReceiptEvent: Schema.StructWithRest<Schema.Struct<{
    readonly receipt: Schema.StructWithRest<Schema.Struct<{
        readonly detail: Schema.optionalKey<Schema.String>;
        readonly message: Schema.StructWithRest<Schema.Struct<{
            readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
            readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
            readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
            readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
        readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
        readonly recordedAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
        readonly seq: Schema.Int;
        readonly state: Schema.String;
        readonly wakeReason: Schema.optionalKey<Schema.String>;
        readonly woke: Schema.optionalKey<Schema.Boolean>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly seq: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type ReceiptEventValue = typeof ReceiptEvent.Type;
export declare const SignedMessage: Schema.StructWithRest<Schema.Struct<{
    readonly appSignature: Schema.StructWithRest<Schema.Struct<{
        readonly algorithm: Schema.String;
        readonly keyId: Schema.brand<Schema.String, "Lexicon:uri">;
        readonly publicKeyMultibase: Schema.optionalKey<Schema.String>;
        readonly signature: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
            readonly $bytes: Schema.Uint8ArrayFromBase64;
        }>, Schema.StructWithRest<Schema.Struct<{
            readonly $bytes: Schema.String;
        }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly canonicalSigningBytes: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
        readonly $bytes: Schema.Uint8ArrayFromBase64;
    }>, Schema.StructWithRest<Schema.Struct<{
        readonly $bytes: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type SignedMessageValue = typeof SignedMessage.Type;
export declare const SigningPayload: Schema.StructWithRest<Schema.Struct<{
    readonly aad: Schema.StructWithRest<Schema.Struct<{
        readonly expiresAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
        readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
        readonly recipientDid: Schema.brand<Schema.String, "Lexicon:did">;
        readonly recipientKeyId: Schema.brand<Schema.String, "Lexicon:uri">;
        readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly body: Schema.decodeTo<Schema.Uint8Array, Schema.compose<Schema.Struct<{
        readonly $bytes: Schema.Uint8ArrayFromBase64;
    }>, Schema.StructWithRest<Schema.Struct<{
        readonly $bytes: Schema.String;
    }>, readonly [Schema.$Record<Schema.String, Schema.String>]>>, never, never>;
    readonly createdAt: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:datetime">>;
    readonly replyTo: Schema.optionalKey<Schema.StructWithRest<Schema.Struct<{
        readonly cid: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:cid">>;
        readonly messageId: Schema.brand<Schema.String, "Lexicon:tid">;
        readonly senderDid: Schema.brand<Schema.String, "Lexicon:did">;
        readonly uri: Schema.optionalKey<Schema.brand<Schema.String, "Lexicon:at-uri">>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>>;
    readonly suite: Schema.StructWithRest<Schema.Struct<{
        readonly aeadId: Schema.Int;
        readonly kdfId: Schema.Int;
        readonly kemId: Schema.Int;
    }>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
    readonly urgent: Schema.optionalKey<Schema.Literal<true>>;
    readonly version: Schema.Int;
}>, readonly [Schema.$Record<Schema.String, Schema.Codec<Runtime.LexValue, Runtime.LexJson, never, never>>]>;
export type SigningPayloadValue = typeof SigningPayload.Type;
