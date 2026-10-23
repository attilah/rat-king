import { Clock, Data, Effect, Option, Random } from "effect";

export interface HeldHolder {
  readonly expiresAt: string;
  readonly session: string;
}

export const RECOVERY_JITTER_MS = 2000;

export type Verdict = Data.TaggedEnum<{
  Wait: { readonly delayMs: number };
  Park: { readonly holder: string };
}>;

export const HeldVerdict = Data.taggedEnum<Verdict>();

export const judgeHeld = (input: {
  readonly holder: Option.Option<HeldHolder>;
  readonly jitterMs: number;
  readonly now: number;
  readonly session: string;
}): Verdict =>
  Option.match(input.holder, {
    onNone: () => HeldVerdict.Wait({ delayMs: input.jitterMs }),
    onSome: (held) => {
      const expiry = Date.parse(held.expiresAt);

      return held.session === input.session || expiry <= input.now
        ? HeldVerdict.Wait({
            delayMs: Math.max(0, expiry - input.now) + input.jitterMs,
          })
        : HeldVerdict.Park({ holder: held.session });
    },
  });

export const recoverHeld = <E>(options: {
  readonly park: Effect.Effect<void>;
  readonly resolve: Effect.Effect<Option.Option<HeldHolder>, E>;
  readonly retrying: Effect.Effect<void>;
  readonly session: string;
}) =>
  Effect.gen(function* recover() {
    const holder = yield* options.resolve;
    const now = yield* Clock.currentTimeMillis;
    const jitterMs = yield* Random.nextIntBetween(0, RECOVERY_JITTER_MS);

    const verdict = judgeHeld({
      holder,
      jitterMs,
      now,
      session: options.session,
    });

    yield* HeldVerdict.$match(verdict, {
      Park: () => options.park,
      Wait: ({ delayMs }) =>
        options.retrying.pipe(Effect.andThen(Effect.sleep(delayMs))),
    });
  });
