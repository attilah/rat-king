import { Schema } from "effect";
import type { Effect } from "effect";
export declare const RetryEvent: Schema.Literals<readonly ["acquireOk", "acquireLeaseHeld", "acquireMailboxUnavailable", "acquireTimeout", "acquireOther", "renewLeaseHeld", "renewMailboxUnavailable", "renewTimeout", "renewLeaseExpired", "renewLeaseMismatch", "renewOther", "consumeReconnect", "sendRetry"]>;
export type RetryEvent = typeof RetryEvent.Type;
export type RetryObserver = (event: RetryEvent) => Effect.Effect<void>;
export declare const retryFailure: (operation: "acquire" | "renew", error: {
    readonly error?: string;
    readonly reason: string;
}) => RetryEvent;
