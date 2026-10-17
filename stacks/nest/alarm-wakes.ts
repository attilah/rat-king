import { Schema } from "effect";

import {
  healthVerdict,
  MailboxHealth,
} from "../../packages/mailbox-client/src/health.ts";
import type { AlarmReadingValue } from "./alarm-config.ts";

export const WakeTarget = Schema.Struct({
  name: Schema.String,
  owner: Schema.NullOr(Schema.String),
});

export const WakeSighting = Schema.Struct({
  ...WakeTarget.fields,
  health: Schema.NullOr(MailboxHealth),
});

export const stalledWakes = (
  seen: readonly (typeof WakeSighting.Type)[],
  now: number
) =>
  seen.filter(
    (item) =>
      item.health !== null &&
      healthVerdict({ ...item.health, reader: "unknown" }, now) ===
        "agent not taking turns"
  );

export const newWakeTargets = (
  prior: readonly (typeof WakeTarget.Type)[],
  seen: readonly (typeof WakeSighting.Type)[],
  now: number
) =>
  stalledWakes(seen, now).some(
    (item) => !prior.some((target) => target.name === item.name)
  );

export const rememberWakeTargets = (
  prior: readonly (typeof WakeTarget.Type)[],
  seen: readonly (typeof WakeSighting.Type)[] | null | undefined,
  reading: AlarmReadingValue,
  now: number
) =>
  reading.status === "ok"
    ? []
    : [
        ...new Map(
          [...prior, ...stalledWakes(seen ?? [], now)].map((item) => [
            item.name,
            { name: item.name, owner: item.owner },
          ])
        ).values(),
      ];

export const wakeReading = (
  seen: readonly (typeof WakeSighting.Type)[] | null | undefined,
  now: number,
  expected: readonly string[] = []
): AlarmReadingValue => {
  if (seen === null || seen === undefined) {
    return { status: "unknown" };
  }

  const stalled = stalledWakes(seen, now);

  if (stalled.length > 0) {
    return {
      evidence: stalled
        .map(
          (item) =>
            `${item.name}: ${item.health?.oldestWake?.id} from ${item.health?.oldestWake?.sender}, delivered ${Math.floor((now - (item.health?.oldestWake?.at ?? now)) / 1000)}s ago, live lease`
        )
        .join("; "),
      recipients: [
        ...new Set(
          stalled.flatMap((item) => (item.owner === null ? [] : [item.owner]))
        ),
      ],
      severity: "warn",
      status: "firing",
    };
  }

  if (expected.some((name) => !seen.some((item) => item.name === name))) {
    return { status: "unknown" };
  }

  return seen.some(
    (item) =>
      item.health === null ||
      !item.health.complete ||
      (item.health.oldestWake !== null &&
        (item.health.lease === null || item.health.lease.expiresAt <= now))
  )
    ? { status: "unknown" }
    : { status: "ok" };
};
