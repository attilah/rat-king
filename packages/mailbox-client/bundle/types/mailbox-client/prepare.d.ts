import * as Defs from "../lexicon/defs.js";
import * as Send from "../lexicon/mailbox.send.js";
import { Data, Effect } from "effect";
import { Document } from "./auth.js";
import type { ConsumeOptions, MessageMeta } from "./consume.js";
import { MailboxClientError } from "./error.js";
import type { LeaseFence, OpenedMessage, SendOptions } from "./mailbox.js";
declare const ownBrand: unique symbol;
export interface OwnIdentity {
    readonly [ownBrand]: true;
}
export declare const ownIdentity: (value: {
    readonly agreement: {
        readonly crv: "P-256";
        readonly d: string;
        readonly kty: "EC";
        readonly x: string;
        readonly y: string;
    };
    readonly did: string;
    readonly signing: {
        readonly crv: "P-256";
        readonly d: string;
        readonly kty: "EC";
        readonly x: string;
        readonly y: string;
    };
}) => Effect.Effect<OwnIdentity, MailboxClientError, never>;
export type PeerDocument = typeof Document.Type;
export type SendOutcome = {
    readonly _tag: "NotAttempted";
    readonly reason: string;
} | {
    readonly _tag: "Rejected";
    readonly error: MailboxClientError;
} | {
    readonly _tag: "Accepted";
    readonly receipt: Send.OutputValue["receipt"];
} | {
    readonly _tag: "Uncertain";
    readonly error: MailboxClientError;
};
export declare const SendOutcomes: {
    readonly $is: <Tag extends "Accepted" | "NotAttempted" | "Rejected" | "Uncertain">(tag: Tag) => (u: unknown) => u is Extract<{
        readonly _tag: "NotAttempted";
        readonly reason: string;
    }, {
        readonly _tag: Tag;
    }> | Extract<{
        readonly _tag: "Rejected";
        readonly error: MailboxClientError;
    }, {
        readonly _tag: Tag;
    }> | Extract<{
        readonly _tag: "Accepted";
        readonly receipt: Send.OutputValue["receipt"];
    }, {
        readonly _tag: Tag;
    }> | Extract<{
        readonly _tag: "Uncertain";
        readonly error: MailboxClientError;
    }, {
        readonly _tag: Tag;
    }>;
    readonly $match: {
        <Cases extends { readonly [Tag in "Accepted" | "NotAttempted" | "Rejected" | "Uncertain"]: (args: Extract<SendOutcome, {
            readonly _tag: Tag;
        }>) => any; }>(cases: Cases): (value: SendOutcome) => import("effect/Unify").Unify<ReturnType<Cases["Accepted" | "NotAttempted" | "Rejected" | "Uncertain"]>>;
        <Cases extends { readonly [Tag in "Accepted" | "NotAttempted" | "Rejected" | "Uncertain"]: (args: Extract<SendOutcome, {
            readonly _tag: Tag;
        }>) => any; }>(value: SendOutcome, cases: Cases): import("effect/Unify").Unify<ReturnType<Cases["Accepted" | "NotAttempted" | "Rejected" | "Uncertain"]>>;
    };
    readonly Accepted: Data.TaggedEnum.ConstructorFrom<{
        readonly _tag: "Accepted";
        readonly receipt: Send.OutputValue["receipt"];
    }, "_tag">;
    readonly NotAttempted: Data.TaggedEnum.ConstructorFrom<{
        readonly _tag: "NotAttempted";
        readonly reason: string;
    }, "_tag">;
    readonly Rejected: Data.TaggedEnum.ConstructorFrom<{
        readonly _tag: "Rejected";
        readonly error: MailboxClientError;
    }, "_tag">;
    readonly Uncertain: Data.TaggedEnum.ConstructorFrom<{
        readonly _tag: "Uncertain";
        readonly error: MailboxClientError;
    }, "_tag">;
};
export type SendResult = SendOutcome & {
    readonly cc?: SendOutcome;
};
export interface PrepareOptions {
    readonly own: OwnIdentity;
    readonly peers: readonly PeerDocument[];
    readonly endpoint: string;
    readonly serviceDid: string;
}
export declare const prepare: (options: PrepareOptions) => Effect.Effect<{
    consume: <E, R>(handler: (message: OpenedMessage, meta: MessageMeta) => Effect.Effect<void, E, R>, opts: ConsumeOptions) => Effect.Effect<void, E | MailboxClientError, R>;
    head: Effect.Effect<number, MailboxClientError, never>;
    mailbox: {
        readonly send: (to: string, body: string, opts?: SendOptions) => Effect.Effect<Send.OutputValue, MailboxClientError>;
        readonly list: (params: {
            readonly afterSeq?: number;
            readonly cursor?: string;
            readonly limit?: number;
        }) => Effect.Effect<import("../lexicon/mailbox.list.js").OutputValue, MailboxClientError>;
        readonly poll: (afterSeq: number) => Effect.Effect<import("./mailbox.js").Batch, MailboxClientError>;
        readonly watch: (afterSeq: number, fence: LeaseFence) => import("effect/Stream").Stream<import("./mailbox.js").Batch, MailboxClientError>;
        readonly open: (envelope: Defs.EncryptedEnvelopeValue) => Effect.Effect<OpenedMessage, MailboxClientError>;
        readonly deliver: (input: import("./mailbox.js").FencedMessage) => Effect.Effect<import("../lexicon/mailbox.deliver.js").OutputValue, MailboxClientError>;
        readonly ack: (input: import("./mailbox.js").FencedMessage) => Effect.Effect<import("../lexicon/mailbox.ack.js").OutputValue, MailboxClientError>;
        readonly lease: {
            readonly acquire: (input: import("./mailbox.js").AcquireRequest) => Effect.Effect<import("../lexicon/runtime.lease.js").MainValue, MailboxClientError>;
            readonly renew: (input: LeaseFence & {
                readonly expiresAt: string;
                readonly renders?: readonly string[];
            }) => Effect.Effect<import("../lexicon/runtime.lease.js").MainValue, MailboxClientError>;
            readonly resolve: (did: string) => Effect.Effect<import("../lexicon/runtime.lease.js").MainValue, MailboxClientError>;
            readonly release: (input: LeaseFence) => Effect.Effect<void, MailboxClientError>;
        };
        readonly putDidDocument: (document: Defs.DidDocumentValue) => Effect.Effect<import("../lexicon/admin.putDidDocument.js").OutputValue, MailboxClientError>;
    };
    open: (envelope: Defs.EncryptedEnvelopeValue) => Effect.Effect<OpenedMessage, MailboxClientError>;
    presence: (did: string) => Effect.Effect<{
        readonly [x: string]: import("../lexicon/runtime.js").LexValue;
        readonly did: string & import("effect/Brand").Brand<"Lexicon:did">;
        readonly held: boolean;
        readonly lastHeldAt?: string & import("effect/Brand").Brand<"Lexicon:datetime">;
        readonly renders?: readonly string[];
    }, MailboxClientError, never>;
    refresh: (did: string) => Effect.Effect<{
        readonly authentication: readonly string[];
        readonly id: string;
        readonly keyAgreement: readonly string[];
        readonly verificationMethod: readonly {
            readonly controller: string;
            readonly id: string;
            readonly publicKeyJwk: {
                readonly crv: "P-256";
                readonly d?: never;
                readonly kty: "EC";
                readonly x: string;
                readonly y: string;
            };
        }[];
    }, MailboxClientError, never>;
    resolveLease: (did: string) => Effect.Effect<import("../lexicon/runtime.lease.js").MainValue, MailboxClientError>;
    seal: (to: string, body: string | ((messageId: string) => string), opts?: SendOptions | undefined) => Effect.Effect<{
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
    }, MailboxClientError | import("../lexicon/xrpc-failure.js").XrpcFailure, never>;
    send: (envelope: {
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
    }, opts?: {
        readonly cc?: string;
        readonly fence?: LeaseFence;
    } | undefined) => Effect.Effect<SendResult, never, never>;
}, MailboxClientError, import("effect/http/HttpClient").HttpClient | import("effect/Scope").Scope>;
export {};
