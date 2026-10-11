import { Context, Effect, Match, Predicate, Schema } from "effect";
import { createMachine, initialTransition, transition } from "xstate";

import { Alert, isJsonObject } from "../../apps/billing-ingress/contracts.ts";
import type { AlertValue } from "../../apps/billing-ingress/contracts.ts";
import type { RelayFailure } from "./billing-failure.ts";
import { Sealed } from "./seal.ts";

export const billingRelayMachine = createMachine({
  context: {},
  id: "billing-relay",
  initial: "pending",
  states: {
    acked: { type: "final" },
    pending: { on: { SEALED: { target: "sealed" }, SENT: { target: "sent" } } },
    refused: { type: "final" },
    sealed: { on: { SUBMIT: { target: "sending" } } },
    sending: {
      on: {
        REFUSED: { target: "refused" },
        RETRY: { target: "sealed" },
        SUCCESS: { target: "sent" },
      },
    },
    sent: { on: { ACK: { target: "acked" } } },
  },
});

export const JournalEntry = Schema.Struct({
  alert: Alert,
  sealed: Sealed,
  sent: Schema.Boolean,
});

export type JournalEntryValue = typeof JournalEntry.Type;

export { RelayFailure } from "./billing-failure.ts";

export class BillingRelay extends Context.Service<
  BillingRelay,
  {
    readonly load: (
      id: string
    ) => Effect.Effect<JournalEntryValue | undefined, RelayFailure>;
    readonly save: (
      entry: JournalEntryValue
    ) => Effect.Effect<void, RelayFailure>;
    readonly seal: (
      alert: AlertValue
    ) => Effect.Effect<typeof Sealed.Type, RelayFailure>;
    readonly send: (
      sealed: typeof Sealed.Type
    ) => Effect.Effect<number, RelayFailure>;
    readonly ack: (id: string) => Effect.Effect<void, RelayFailure>;
    readonly refused: (id: string, code: number) => Effect.Effect<void>;
  }
>()("Billing.Relay") {}

export const billingSummary = (payload: Schema.Json) => {
  if (!isJsonObject(payload)) {
    return "billing: alert";
  }

  const name =
    payload.name ?? payload.alert_name ?? payload.policy_name ?? "alert";

  const numbers = Object.entries(payload)
    .flatMap(([key, value]) =>
      Predicate.isNumber(value) ? [`${key}=${value}`] : []
    )
    .join(" ");

  return `billing: ${Predicate.isString(name) ? name : "alert"} ${numbers}`
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
};

export const billingBody = (payload: Schema.Json) =>
  JSON.stringify(payload, null, 2).slice(0, 24_000);

export const relayAlert = Effect.fn("Billing.relayAlert")(function* relayAlert(
  alert: AlertValue
) {
  const relay = yield* BillingRelay;
  let [state] = initialTransition(billingRelayMachine);
  let entry = yield* relay.load(alert.id);

  if (entry === undefined) {
    entry = { alert, sealed: yield* relay.seal(alert), sent: false };
    yield* relay.save(entry);
  }

  [state] = transition(billingRelayMachine, state, {
    type: entry.sent ? "SENT" : "SEALED",
  });

  if (state.matches("sealed")) {
    [state] = transition(billingRelayMachine, state, { type: "SUBMIT" });
    const code = yield* relay.send(entry.sealed);
    [state] = transition(billingRelayMachine, state, {
      type: Match.value(code).pipe(
        Match.when(0, () => "SUCCESS"),
        Match.when(3, () => "RETRY"),
        Match.orElse(() => "REFUSED")
      ),
    });

    if (state.matches("refused")) {
      yield* relay.refused(alert.id, code);

      return "refused";
    }

    if (state.matches("sealed")) {
      return "retry";
    }

    entry = { alert: entry.alert, sealed: entry.sealed, sent: true };
    yield* relay.save(entry);
  }

  yield* relay.ack(alert.id);
  [state] = transition(billingRelayMachine, state, { type: "ACK" });

  return state.value;
});
