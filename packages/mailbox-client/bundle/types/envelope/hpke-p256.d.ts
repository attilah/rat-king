import { DhkemP256HkdfSha256 } from "@hpke/core";
export declare const p256PublicPoint: (raw: ArrayBuffer) => ArrayBuffer;
export declare const p256PublicJwk: (raw: ArrayBufferLike | ArrayBufferView) => JsonWebKey;
export declare class CompatibleP256Kem extends DhkemP256HkdfSha256 {
    constructor();
}
