/* oxlint-disable eslint/no-redeclare -- Schema value and inferred type share the counter contract name. */
import { Match, Schema } from "effect";
import type { Effect } from "effect";

export const RetryEvent = Schema.Literals([
  "acquireOk",
  "acquireLeaseHeld",
  "acquireMailboxUnavailable",
  "acquireTimeout",
  "acquireOther",
  "renewLeaseHeld",
  "renewMailboxUnavailable",
  "renewTimeout",
  "renewLeaseExpired",
  "renewLeaseMismatch",
  "renewOther",
  "consumeReconnect",
  "sendRetry",
]);

export type RetryEvent = typeof RetryEvent.Type;

export type RetryObserver = (event: RetryEvent) => Effect.Effect<void>;

export const retryFailure = (
  operation: "acquire" | "renew",
  error: { readonly error?: string; readonly reason: string }
): RetryEvent => {
  if (
    error.reason === "Acquire attempt timed out" ||
    error.reason === "Renewal attempt timed out"
  ) {
    return operation === "acquire" ? "acquireTimeout" : "renewTimeout";
  }

  if (operation === "acquire") {
    return Match.value(error.error ?? "").pipe(
      Match.when("LeaseHeld", () => "acquireLeaseHeld" as const),
      Match.when(
        "MailboxUnavailable",
        () => "acquireMailboxUnavailable" as const
      ),
      Match.orElse(() => "acquireOther" as const)
    );
  }

  return Match.value(error.error ?? "").pipe(
    Match.when("LeaseHeld", () => "renewLeaseHeld" as const),
    Match.when("MailboxUnavailable", () => "renewMailboxUnavailable" as const),
    Match.when("LeaseExpired", () => "renewLeaseExpired" as const),
    Match.when("LeaseMismatch", () => "renewLeaseMismatch" as const),
    Match.orElse(() => "renewOther" as const)
  );
};
