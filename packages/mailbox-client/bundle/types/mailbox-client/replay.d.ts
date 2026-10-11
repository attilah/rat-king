import type { XrpcFailure } from "../lexicon/xrpc-failure.js";
import { Context } from "effect";
import type { Effect } from "effect";
import type { ClaimsValue } from "./auth.js";
export interface ReplayInterface {
    readonly consume: (claims: ClaimsValue, now: number) => Effect.Effect<void, XrpcFailure>;
}
declare const ReplayAuthority_base: Context.ServiceClass<ReplayAuthority, "mailbox/ReplayAuthority", ReplayInterface>;
export declare class ReplayAuthority extends ReplayAuthority_base {
}
export {};
