/* oxlint-disable eslint/no-redeclare -- Schema value and inferred type share the snapshot contract name. */
import { Schema } from "effect";

import { RetryEvent } from "../../mailbox-client/src/retry-metrics.ts";
import { AgentName } from "./name.ts";

export const RETRY_WINDOW_MS = 60_000;

export const RETRY_WINDOWS = 60;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const RetryBucket = Schema.Struct({
  counts: Schema.Record(RetryEvent, Count),
  name: AgentName,
  start: Count,
});

export const RetrySnapshot = Schema.Struct({
  buckets: Schema.Array(RetryBucket).check(Schema.isMaxLength(RETRY_WINDOWS)),
  evictedEvents: Count,
  windowMs: Schema.Literal(RETRY_WINDOW_MS),
});

export type RetrySnapshot = typeof RetrySnapshot.Type;

const emptyCounts = () => ({
  acquireLeaseHeld: 0,
  acquireMailboxUnavailable: 0,
  acquireOk: 0,
  acquireOther: 0,
  acquireTimeout: 0,
  consumeReconnect: 0,
  renewLeaseExpired: 0,
  renewLeaseHeld: 0,
  renewLeaseMismatch: 0,
  renewMailboxUnavailable: 0,
  renewOther: 0,
  renewTimeout: 0,
  sendRetry: 0,
});

export const countRetry = (
  snapshot: RetrySnapshot,
  name: string,
  event: RetryEvent,
  now: number
): RetrySnapshot => {
  const start = Math.floor(now / RETRY_WINDOW_MS) * RETRY_WINDOW_MS;

  const found = snapshot.buckets.find(
    (bucket) => bucket.name === name && bucket.start === start
  );

  let buckets =
    found === undefined
      ? [...snapshot.buckets, { counts: emptyCounts(), name, start }]
      : [...snapshot.buckets];

  buckets = buckets.map((bucket) =>
    bucket.name === name && bucket.start === start
      ? {
          ...bucket,
          counts: { ...bucket.counts, [event]: bucket.counts[event] + 1 },
        }
      : bucket
  );
  const removed = buckets.slice(0, Math.max(0, buckets.length - RETRY_WINDOWS));

  return {
    buckets: buckets.slice(-RETRY_WINDOWS),
    evictedEvents:
      snapshot.evictedEvents +
      removed.reduce(
        (sum, bucket) =>
          sum + Object.values(bucket.counts).reduce((a, b) => a + b, 0),
        0
      ),
    windowMs: RETRY_WINDOW_MS,
  };
};

export const emptyRetries = (): RetrySnapshot => ({
  buckets: [],
  evictedEvents: 0,
  windowMs: RETRY_WINDOW_MS,
});
