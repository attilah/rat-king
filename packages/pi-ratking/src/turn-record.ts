import type { TurnValue } from "@rat-king/lexicon/turns";
import { Turn } from "@rat-king/lexicon/turns";
import { Settings } from "@rat-king/ratking-client/config";
import type { SessionFacts } from "@rat-king/ratking-client/identity";
import { LexiconRecord } from "@rat-king/ratking-client/payload";
import { RatKing } from "@rat-king/ratking-client/ratking";
import { Clock, DateTime, Effect, Option, Schema } from "effect";

export type StopReason = "stop" | "aborted" | "error" | "length";

export const stopReason = (messages: readonly unknown[]): StopReason => {
  const Assistant = Schema.Struct({
    role: Schema.Literal("assistant"),
    stopReason: Schema.Literals([
      "stop",
      "aborted",
      "error",
      "length",
      "toolUse",
    ]),
  });

  const last = messages.findLast(Schema.is(Assistant));

  return last === undefined || last.stopReason === "toolUse"
    ? "stop"
    : last.stopReason;
};

export const turnReporter = (
  facts: SessionFacts,
  initial = 0,
  remember?: (n: number) => void
) => {
  let n = initial;
  let lastAt = -1;
  let announced = false;
  let open = false;
  let lastStop: StopReason = "stop";

  const emit = Effect.fn("RatKing.emitTurn")(
    function* emit(
      state: TurnValue["state"],
      turnNumber: number,
      detail?: { readonly reason?: string; readonly stopReason?: StopReason }
    ) {
      const settings = yield* Settings;

      if (settings.turnRecords !== true) {
        return;
      }

      const owner = facts.owner ?? Option.none<string>();

      if (Option.isNone(owner)) {
        return;
      }

      const ratking = yield* RatKing;
      const status = yield* ratking.status;

      if (
        Option.isNone(status.self) ||
        owner.value === status.self.value.name
      ) {
        return;
      }

      const clock = yield* Clock.currentTimeMillis;
      const now = Math.max(clock, lastAt + 1);
      lastAt = now;

      const record = yield* Schema.decodeUnknownEffect(Turn)({
        $type: "sh.mschf.agentgraph.turn",
        agent: status.self.value.name,
        at: DateTime.formatIso(DateTime.makeUnsafe(now)),
        session: facts.session,
        state,
        turnId: `${facts.session}:${turnNumber}`,
        version: "0.1",
        ...detail,
      });

      const json = yield* Schema.decodeUnknownEffect(LexiconRecord)(record);
      yield* ratking.send(owner.value, json);
    },
    (effect) =>
      effect.pipe(
        Effect.timeout("10 seconds"),
        Effect.catchCause((cause) =>
          Effect.logWarning("Rat King turn record failed", cause)
        )
      )
  );

  return {
    approval: () =>
      emit("blocked", n, { reason: "Pi is waiting for approval" }),
    done: (reason: StopReason) =>
      Effect.suspend(() => {
        open = false;
        lastStop = reason;

        return emit("done", n, { stopReason: reason });
      }),
    idle: () =>
      Effect.gen(function* idle() {
        if (!announced) {
          announced = true;

          if (open) {
            yield* emit("working", n);
          } else if (n > initial) {
            yield* emit("done", n, { stopReason: lastStop });
          } else {
            yield* emit("idle", n);
          }
        }
      }),
    waitForReply: <A, E, R>(reply: Effect.Effect<A, E, R>) =>
      emit("blocked", n, { reason: "Pi is waiting for an ask reply" }).pipe(
        Effect.andThen(reply),
        Effect.ensuring(emit("working", n))
      ),
    working: () =>
      Effect.gen(function* working() {
        n += 1;
        open = true;
        remember?.(n);
        yield* emit("working", n);
      }),
  };
};

export type TurnReporter = ReturnType<typeof turnReporter>;
