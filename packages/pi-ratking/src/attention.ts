import * as Prefs from "@rat-king/lexicon/attention.prefs";
import * as Status from "@rat-king/lexicon/attention.status";
import { Effect, Ref, Schema } from "effect";

import {
  fromBasisPoints,
  toBasisPoints,
} from "../../mailbox-client/src/attention.ts";
import type { AttentionClient } from "../../mailbox-client/src/attention.ts";
import type { MailboxClientError } from "../../mailbox-client/src/error.ts";
import type { Levers } from "./attend.ts";
import type { NotDelivered } from "./ratking.ts";

export interface AttentionChange {
  readonly note?: string;
  readonly prefs?: unknown;
  readonly status?: "available" | "busy" | "dnd";
  readonly until?: string;
}

export interface AttentionValue {
  readonly prefs: Prefs.MainValue;
  readonly status: Status.MainValue;
}

export interface AttentionApi {
  readonly levers: Effect.Effect<Levers>;
  readonly change: (
    change: AttentionChange
  ) => Effect.Effect<
    AttentionValue,
    NotDelivered | MailboxClientError | Schema.SchemaError
  >;
  readonly refresh: Effect.Effect<void, NotDelivered | MailboxClientError>;
}

export const decimalPreferences = (prefs: Prefs.MainValue) => {
  const { jev } = prefs.model;

  return jev === undefined
    ? prefs
    : {
        ...prefs,
        model: {
          ...prefs.model,
          jev: {
            judgment: jev.judgment,
            later: fromBasisPoints(jev.laterBp),
            now: fromBasisPoints(jev.nowBp),
          },
        },
      };
};

const Probability = Schema.Finite.check(
  Schema.isBetween({ maximum: 1, minimum: 0 }),
  Schema.makeFilter(
    (value) => fromBasisPoints(toBasisPoints(value)) === value,
    { expected: "probability with at most four decimal places" }
  )
);

const DecimalJev = Schema.Struct({
  judgment: Prefs.Jev.schema.fields.judgment,
  later: Probability,
  now: Probability,
});

export const ToolPreferences = Schema.Struct({
  ...Prefs.Main.schema.fields,
  model: Schema.Struct({
    ...Prefs.Model.schema.fields,
    jev: Schema.optionalKey(DecimalJev),
  }),
});

export type ToolPreferencesValue = typeof ToolPreferences.Type;

export const wirePreferences = (
  prefs: ToolPreferencesValue
): Prefs.MainValue => {
  const { jev } = prefs.model;

  if (jev === undefined) {
    const { jev: _jev, ...model } = prefs.model;

    return { ...prefs, model };
  }

  return {
    ...prefs,
    model: {
      ...prefs.model,
      jev: {
        judgment: jev.judgment,
        laterBp: toBasisPoints(jev.later),
        nowBp: toBasisPoints(jev.now),
      },
    },
  };
};

export const attentionReader = Effect.fn("Attention.reader")(
  function* attentionReader(
    enabled: boolean,
    client: Effect.Effect<AttentionClient, NotDelivered | MailboxClientError>
  ) {
    const snapshot = yield* Ref.make<Levers>({ enabled });

    const refresh = Effect.gen(function* refresh() {
      const port = yield* client;
      const prefs = yield* port.getPreferences();
      const status = yield* port.getStatus();
      yield* Ref.set(snapshot, { enabled, prefs, status });
    });

    return {
      change: Effect.fn("Attention.change")(function* change(input) {
        const port = yield* client;
        let prefs = yield* port.getPreferences();
        let status = yield* port.getStatus();

        if (input.prefs !== undefined) {
          prefs = yield* port.putPreferences(
            yield* Schema.decodeUnknownEffect(Prefs.Main)(
              wirePreferences(
                yield* Schema.decodeUnknownEffect(ToolPreferences)(
                  input.prefs,
                  { onExcessProperty: "error" }
                )
              )
            )
          );
        }

        if (
          input.status !== undefined ||
          input.until !== undefined ||
          input.note !== undefined
        ) {
          const value = {
            $type: "sh.mschf.ratking.attention.status",
            state: input.status ?? status.state,
            version: "0.1",
          };

          if (input.until !== undefined) {
            Object.assign(value, { until: input.until });
          }

          if (input.note !== undefined) {
            Object.assign(value, { note: input.note });
          }

          status = yield* port.putStatus(
            yield* Schema.decodeUnknownEffect(Status.Main)(value)
          );
        }

        yield* Ref.set(snapshot, { enabled, prefs, status });

        return { prefs, status };
      }),
      levers: Ref.get(snapshot),
      refresh,
    } satisfies AttentionApi;
  }
);
