import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Option,
  Schedule,
} from "effect";

export const Deadline = Context.Reference<number>("RatKing/Deadline", {
  defaultValue: () => Number.POSITIVE_INFINITY,
});

export const REQUEST_MS = 10_000;

export const OPERATION_MS = 90_000;

export const LEASE_MS = 3000;

export const remaining = Effect.gen(function* remaining() {
  const at = yield* Deadline;

  return Math.max(0, at - (yield* Clock.currentTimeMillis));
});

export const canAttempt = (attemptMs: number, delayMs = 0) =>
  remaining.pipe(Effect.map((left) => left >= attemptMs + delayMs));

export const retryBudget =
  (attemptMs: number) =>
  <O, I, E, R>(schedule: Schedule.Schedule<O, I, E, R>) =>
    schedule.pipe(
      Schedule.while(({ duration }) =>
        canAttempt(attemptMs, Duration.toMillis(duration))
      )
    );

export const timeoutOrElse =
  <A2, E2, R2>(options: {
    readonly duration: Duration.Input;
    readonly orElse: () => Effect.Effect<A2, E2, R2>;
  }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* withinDeadline() {
      const now = yield* Clock.currentTimeMillis;

      const at = Math.min(
        yield* Deadline,
        now + Duration.toMillis(Duration.fromInputUnsafe(options.duration))
      );

      const left = at - now;

      if (left <= 0) {
        return yield* options.orElse();
      }

      return yield* effect.pipe(
        Effect.provideService(Deadline, at),
        Effect.timeoutOrElse({ duration: left, orElse: options.orElse })
      );
    });

export const timeout = (duration: Duration.Input) =>
  timeoutOrElse({
    duration,
    orElse: () =>
      Effect.fail(new Cause.TimeoutError("Mailbox deadline exceeded")),
  });

export const timeoutOption =
  (duration: Duration.Input) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.map(Option.some),
      timeoutOrElse({
        duration,
        orElse: () => Effect.succeed(Option.none<A>()),
      })
    );
