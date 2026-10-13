import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Result, Schema } from "effect";
import { expect } from "vitest";

import {
  defaultPreferences,
  defaultStatus,
} from "../../mailbox-client/src/attention.ts";
import { attentionReader } from "../src/attention.ts";
import { resolveAttentionLevers } from "../src/config.ts";
import { inbox } from "../src/pending.ts";

const Points = Schema.Int.check(Schema.isBetween({ maximum: 999, minimum: 1 }));

it.effect.prop(
  "Invalid decimals are typed refusals before any signed write",
  [Points],
  ([points]) =>
    Effect.gen(function* refusal() {
      let writes = 0;

      const reader = yield* attentionReader(
        false,
        Effect.succeed({
          getPreferences: () => Effect.succeed(defaultPreferences()),
          getStatus: () => Effect.succeed(defaultStatus()),
          putPreferences: (prefs) =>
            Effect.sync(() => {
              writes += 1;

              return prefs;
            }),
          putStatus: (status) =>
            Effect.sync(() => {
              writes += 1;

              return status;
            }),
        })
      );

      for (const now of [
        -points / 10_000,
        1 + points / 10_000,
        (points * 10 + 1) / 100_000,
      ]) {
        const result = yield* reader
          .change({
            prefs: {
              ...defaultPreferences(),
              model: {
                body: "summary",
                jev: { judgment: "needs attention", later: 0, now },
                kind: "jev",
                timeoutMs: 2000,
              },
            },
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);

        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe("SchemaError");
        }
      }

      expect(writes).toBe(0);
    })
);

it.effect.prop(
  "Attention is off by default; RATKING_ATTENTION explicitly overrides the config",
  [Schema.Boolean, Schema.Literals(["0", "1"])],
  ([configured, value]) =>
    Effect.gen(function* flags() {
      const absent = ConfigProvider.layer(ConfigProvider.fromUnknown({}));
      expect(
        yield* resolveAttentionLevers({}).pipe(Effect.provide(absent))
      ).toBe(false);
      expect(
        yield* resolveAttentionLevers({ attentionLevers: configured }).pipe(
          Effect.provide(absent)
        )
      ).toBe(configured);
      expect(
        yield* resolveAttentionLevers({ attentionLevers: configured }).pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ RATKING_ATTENTION: value })
            )
          )
        )
      ).toBe(value === "1");
    })
);

it.prop(
  "A shorter CC digest cannot release a lever-held message before its deadline",
  [Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 2 }))],
  ([seconds]) => {
    const shown: string[] = [];

    const mail = inbox({
      digest: (mails) => {
        shown.push(...mails.map((item) => item.id));
      },
      show: () => {},
    });

    mail.tick(0);
    mail.take(
      {
        content: "held original",
        details: {},
        digestMinutes: seconds / 60,
        id: "held",
        notBefore: seconds * 1000,
      },
      "digest"
    );
    mail.take(
      { content: "short digest", details: {}, digestMinutes: 1 / 60, id: "cc" },
      "digest"
    );
    mail.tick(1000);
    expect(shown).toEqual(["cc"]);
    mail.tick(seconds * 1000 - 1);
    expect(shown).toEqual(["cc"]);
    mail.tick(seconds * 1000);
    expect(shown).toEqual(["cc", "held"]);
  }
);
