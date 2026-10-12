import { DateTime, Effect, FileSystem, Schema } from "effect";

import type { AlarmReadingValue, AlarmSettingsValue } from "./alarm-config.ts";

export const SESSIONS_BACKUP_MAX_AGE_MS = 8 * 86_400_000;

export const SessionsBackupFact = Schema.Struct({
  alarm: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.Finite),
});

export type SessionsBackupFactValue = typeof SessionsBackupFact.Type;

const Receipt = Schema.fromJsonString(
  Schema.Struct({
    completed_at: Schema.DateTimeUtcFromString,
    status: Schema.Literal("success"),
  })
);

const Raised = Schema.fromJsonString(
  Schema.Struct({ raised_at: Schema.optionalKey(Schema.String) })
);

export const collectSessionsBackup = Effect.fn("Alarm.collectSessionsBackup")(
  function* collectSessionsBackup(
    settings: NonNullable<AlarmSettingsValue["sessionsBackup"]>
  ) {
    const fs = yield* FileSystem.FileSystem;

    const alarm = (yield* fs.exists(settings.alarmFile))
      ? yield* fs.readFileString(settings.alarmFile).pipe(
          Effect.flatMap(Schema.decodeEffect(Raised)),
          Effect.map((raised) => raised.raised_at ?? "present"),
          Effect.orElseSucceed(() => "present")
        )
      : null;

    const completedAt = (yield* fs.exists(settings.receipt))
      ? DateTime.toEpochMillis(
          (yield* Schema.decodeEffect(Receipt)(
            yield* fs.readFileString(settings.receipt)
          )).completed_at
        )
      : null;

    const fact: SessionsBackupFactValue = { alarm, completedAt };

    return fact;
  },
  (effect) =>
    effect.pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed((): SessionsBackupFactValue | null => null)
    )
);

export const sessionsBackupReading = (
  fact: SessionsBackupFactValue | "off" | null | undefined,
  now: number
): AlarmReadingValue => {
  if (fact === undefined || fact === "off") {
    return { status: "ok" };
  }

  if (fact === null) {
    return { status: "unknown" };
  }

  if (fact.alarm !== null) {
    return {
      evidence: `backup ALARM file raised at ${fact.alarm}`,
      severity: "warn",
      status: "firing",
    };
  }

  if (fact.completedAt === null) {
    return {
      evidence: "no success receipt",
      severity: "warn",
      status: "firing",
    };
  }

  const age = now - fact.completedAt;

  return age > SESSIONS_BACKUP_MAX_AGE_MS
    ? {
        evidence: `last success ${Math.floor(age / 86_400_000)} days ago`,
        severity: "warn",
        status: "firing",
      }
    : { status: "ok" };
};
