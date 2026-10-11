import { Context, Duration, Option } from "effect";

export const PRESENCE_TTL_MS = 30_000;

export const PresenceTimeout = Context.Reference<Duration.Duration>(
  "RatKing.PresenceTimeout",
  { defaultValue: () => Duration.seconds(2) }
);

export interface PresenceValue {
  readonly held: boolean;
  readonly lastHeldAt?: string;
}

export const age = (millis: number) => {
  const seconds = Math.max(0, Math.floor(millis / 1000));

  if (seconds < 60) {
    return `${seconds} s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min`;
  }

  if (seconds < 48 * 3600) {
    return `${Math.floor(seconds / 3600)} h`;
  }

  return `${Math.floor(seconds / 86_400)} d`;
};

export const presenceLine = (
  presence: PresenceValue,
  now: number
): Option.Option<string> => {
  if (presence.held) {
    return Option.none();
  }

  if (presence.lastHeldAt === undefined) {
    return Option.some(
      "No reader has ever held this name; the message waits in its mailbox."
    );
  }

  const elapsed = now - Date.parse(presence.lastHeldAt);

  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 900_000) {
    return Option.some(
      `No live reader; last read ${Math.floor(elapsed / 60_000)} min ago. The mail is queued for batch intake.`
    );
  }

  return Option.some(
    `No reader holding this name since ${age(now - Date.parse(presence.lastHeldAt))} ago (${presence.lastHeldAt}); the message waits in its mailbox.`
  );
};
