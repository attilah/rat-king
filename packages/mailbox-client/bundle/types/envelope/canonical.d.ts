import type * as Defs from "../lexicon/defs.js";
import * as Runtime from "../lexicon/runtime.js";
import { Effect } from "effect";
import { EnvelopeFailure } from "./failure.js";
export { concatenate } from "./bytes.js";
export declare const suite: Readonly<{
    aeadId: 1;
    kdfId: 1;
    kemId: 16;
}>;
export declare const plaintextSuite: Readonly<{
    aeadId: 0;
    kdfId: 0;
    kemId: 0;
}>;
export declare const plaintextEnc: () => Uint8Array<ArrayBuffer>;
export declare const signatureDomain: Uint8Array<ArrayBuffer>;
export declare const equalBytes: (left: Uint8Array, right: Uint8Array) => boolean;
export declare const canonical: (value: Runtime.LexValue) => Uint8Array;
export declare const canonicalDecode: (bytes: Uint8Array<ArrayBufferLike>) => Effect.Effect<Runtime.LexValue, EnvelopeFailure, never>;
export declare const signingBytes: (payload: Defs.SigningPayloadValue) => Uint8Array<ArrayBuffer>;
export declare const aadBytes: (envelope: Pick<Defs.EncryptedEnvelopeValue, "version" | "suite" | "enc" | "aad">) => Uint8Array<ArrayBuffer>;
export declare const plaintext: (envelope: Pick<Defs.EncryptedEnvelopeValue, "version" | "suite">) => boolean;
export declare const supported: (envelope: Pick<Defs.EncryptedEnvelopeValue, "version" | "suite">) => boolean;
