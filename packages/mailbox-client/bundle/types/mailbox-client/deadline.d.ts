import { Cause, Context, Duration, Effect, Option, Schedule } from "effect";
export declare const Deadline: Context.Reference<number>;
export declare const REQUEST_MS = 10000;
export declare const OPERATION_MS = 90000;
export declare const LEASE_MS = 3000;
export declare const remaining: Effect.Effect<number, never, never>;
export declare const canAttempt: (attemptMs: number, delayMs?: number) => Effect.Effect<boolean, never, never>;
export declare const retryBudget: (attemptMs: number) => <O, I, E, R>(schedule: Schedule.Schedule<O, I, E, R>) => Schedule.Schedule<O, I, E, R>;
export declare const timeoutOrElse: <A2, E2, R2>(options: {
    readonly duration: Duration.Input;
    readonly orElse: () => Effect.Effect<A2, E2, R2>;
}) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A | A2, E | E2, R2 | Exclude<R, never>>;
export declare const timeout: (duration: Duration.Input) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Cause.TimeoutError, Exclude<R, never>>;
export declare const timeoutOption: (duration: Duration.Input) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Option.Option<A>, E, Exclude<R, never>>;
