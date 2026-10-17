import { Effect } from "effect";

import { prepareAlarmMail } from "./alarm-mail.ts";
import type { WakeTarget } from "./alarm-wakes.ts";
import type { StageConfigValue } from "./stage-config.ts";

export const collectWakeHealth = Effect.fn("Alarm.collectWakeHealth")(
  function* collectWakeHealth(
    config: StageConfigValue,
    readers:
      | readonly { readonly name: string; readonly owner: string | null }[]
      | undefined,
    previous: readonly (typeof WakeTarget.Type)[] = []
  ) {
    if (readers === undefined && previous.length === 0) {
      return null;
    }

    const unique = [
      ...new Map(
        [...previous, ...(readers ?? [])].map((reader) => [reader.name, reader])
      ).values(),
    ];

    if (unique.length === 0) {
      return [];
    }

    const prepared = yield* prepareAlarmMail(
      config,
      unique.map((reader) => reader.name),
      ""
    );

    return yield* Effect.forEach(
      unique,
      (reader) =>
        Effect.gen(function* observe() {
          const target = prepared.targets.find(
            (item) => item.name === reader.name
          );

          const health =
            target === undefined
              ? null
              : yield* prepared.client
                  .health(target.did, target.name)
                  .pipe(Effect.orElseSucceed(() => null));

          return { ...reader, health };
        }),
      { concurrency: 4 }
    );
  },
  Effect.scoped,
  (effect) =>
    effect.pipe(
      Effect.timeout("15 seconds"),
      Effect.orElseSucceed(() => null)
    )
);
