import { DateTime, Effect, FileSystem, Schema } from "effect";

import type { AlarmReadingValue, AlarmSettingsValue } from "./alarm-config.ts";

export const RecallCanaryFact = Schema.Struct({
  alarm: Schema.NullOr(Schema.String),
  receipt: Schema.Union([
    Schema.Literals(["missing", "unreadable"]),
    Schema.Struct({ at: Schema.String, status: Schema.String }),
  ]),
});

export type RecallCanaryFactValue = typeof RecallCanaryFact.Type;

type RecallReceiptValue = RecallCanaryFactValue["receipt"];

const Receipt = Schema.fromJsonString(
  Schema.Struct({
    at: Schema.DateTimeUtcFromString,
    status: Schema.String,
  })
);

const Raised = Schema.fromJsonString(
  Schema.Struct({ raised_at: Schema.optionalKey(Schema.String) })
);

export const collectRecallCanary = Effect.fn("Alarm.collectRecallCanary")(
  function* collectRecallCanary(
    settings: NonNullable<AlarmSettingsValue["recallCanary"]>
  ) {
    const fs = yield* FileSystem.FileSystem;

    const alarm = (yield* fs.exists(settings.alarmFile))
      ? yield* fs.readFileString(settings.alarmFile).pipe(
          Effect.flatMap(Schema.decodeEffect(Raised)),
          Effect.map((raised) => raised.raised_at ?? "present"),
          Effect.orElseSucceed(() => "present")
        )
      : null;

    const receipt: RecallReceiptValue = (yield* fs.exists(settings.receipt))
      ? yield* fs.readFileString(settings.receipt).pipe(
          Effect.flatMap(Schema.decodeEffect(Receipt)),
          Effect.map((decoded): RecallReceiptValue => ({
            at: DateTime.formatIso(decoded.at),
            status: decoded.status,
          })),
          Effect.orElseSucceed((): RecallReceiptValue => "unreadable")
        )
      : "missing";

    const fact: RecallCanaryFactValue = { alarm, receipt };

    return fact;
  },
  (effect) =>
    effect.pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed((): RecallCanaryFactValue | null => null)
    )
);

const warn = (evidence: string): AlarmReadingValue => ({
  evidence,
  severity: "warn",
  status: "firing",
});

export const recallCanaryReading = (
  fact: RecallCanaryFactValue | "off" | null | undefined
): AlarmReadingValue => {
  if (fact === undefined || fact === "off") {
    return { status: "ok" };
  }

  if (fact === null) {
    return { status: "unknown" };
  }

  if (fact.alarm !== null) {
    return warn(`recall canary ALARM raised at ${fact.alarm}`);
  }

  if (fact.receipt === "missing") {
    return warn("no recall canary pass receipt");
  }

  if (fact.receipt === "unreadable") {
    return warn("recall canary receipt unreadable");
  }

  return fact.receipt.status === "pass"
    ? { status: "ok" }
    : warn(
        `recall canary receipt status ${fact.receipt.status} at ${fact.receipt.at}`
      );
};
