import { DateTime, Option, Schema } from "effect";

import { Turn } from "../../packages/lexicon/turns.ts";
import type { TurnValue } from "../../packages/lexicon/turns.ts";
import type { ReaderHeartbeatValue } from "../../packages/pi-ratking/src/reader-health.ts";

export const crashedReader = (
  beat: ReaderHeartbeatValue,
  now: number
): TurnValue | undefined => {
  if (
    beat.owner === undefined ||
    beat.session === undefined ||
    beat.generation === undefined
  ) {
    return undefined;
  }

  const expired =
    beat.leaseUntil !== undefined &&
    beat.leaseUntil !== null &&
    now >= DateTime.toEpochMillis(beat.leaseUntil);

  const acquiring =
    beat.state === "Acquiring" &&
    beat.acquisitionSince !== undefined &&
    beat.leaseTtlMs !== undefined &&
    now >=
      DateTime.toEpochMillis(beat.acquisitionSince) + beat.leaseTtlMs + 10_000;

  if (!expired && !acquiring) {
    return undefined;
  }

  const record = {
    $type: "sh.mschf.agentgraph.turn",
    agent: beat.name,
    at: DateTime.formatIso(DateTime.makeUnsafe(now)),
    generation: beat.generation,
    reason: expired
      ? "Reader lease lapsed"
      : "Reader acquiring beyond lease TTL plus 10 seconds",
    session: beat.session,
    state: "crashed",
    turnId: `${beat.session}:0`,
    version: "0.1",
  };

  return Schema.decodeUnknownOption(Turn)(record).pipe(Option.getOrUndefined);
};
