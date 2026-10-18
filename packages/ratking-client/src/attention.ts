import * as Prefs from "@rat-king/lexicon/attention.prefs";
import * as Status from "@rat-king/lexicon/attention.status";
import {
  Effect,
  FileSystem,
  Path,
  Predicate,
  Ref,
  Schema,
  Semaphore,
} from "effect";

import {
  fromBasisPoints,
  toBasisPoints,
} from "../../mailbox-client/src/attention.ts";
import type { AttentionClient } from "../../mailbox-client/src/attention.ts";
import type { MailboxClientError } from "../../mailbox-client/src/error.ts";
import type { Levers, Verdict } from "./attend.ts";
import { Settings } from "./config.ts";
import type { NotDelivered } from "./ratking.ts";

export interface AttentionChange {
  readonly delegate?: string;
  readonly exempt?: readonly string[];
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

export const FilterInput = Schema.Struct({
  id: Schema.optionalKey(Prefs.Rule.schema.fields.id),
  op: Schema.Literals(["add", "remove", "list"]),
  rule: Schema.optionalKey(Prefs.Rule),
});

export type FilterInputValue = typeof FilterInput.Type;

export class FilterError extends Schema.TaggedError<FilterError>()(
  "FilterError",
  {
    reason: Schema.String,
  }
) {}

const filterLock = Semaphore.makeUnsafe(1);

const Hits = Schema.Record(
  Schema.String,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
);

const hitFile = Effect.gen(function* hitFile() {
  const settings = yield* Settings;
  const path = yield* Path.Path;

  return path.join(settings.state, "filters", "hits.json");
});

export const filterHits = Effect.gen(function* filterHits() {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* hitFile;

  const text = yield* fs
    .readFileString(file)
    .pipe(
      Effect.catchTag("PlatformError", (error) =>
        Predicate.isTagged(error.reason, "NotFound")
          ? Effect.succeed("{}")
          : Effect.fail(error)
      )
    );

  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Hits))(text);
});

export const countFilterHit = Effect.fn("Attention.countFilterHit")(
  function* countFilterHit(verdict: Verdict | undefined) {
    if (
      verdict === undefined ||
      !Predicate.isTagged(verdict.reason, "lever") ||
      verdict.reason.rule === undefined
    ) {
      return;
    }

    const { rule: id } = verdict.reason;

    yield* filterLock.withPermits(1)(
      Effect.gen(function* saveHit() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = yield* hitFile;
        const directory = path.dirname(file);
        const hits = yield* filterHits;
        const temp = `${file}.tmp`;

        yield* fs.makeDirectory(directory, { mode: 0o700, recursive: true });
        yield* fs.chmod(directory, 0o700);
        yield* fs.writeFileString(
          temp,
          JSON.stringify({ ...hits, [id]: (hits[id] ?? 0) + 1 }),
          { mode: 0o600 }
        );
        yield* fs.chmod(temp, 0o600);
        yield* fs.rename(temp, file);
      })
    );
  }
);

export const filterRules = Effect.fn("Attention.filterRules")(
  function* filterRules(
    change: AttentionApi["change"],
    input: FilterInputValue
  ) {
    const current = yield* change({});
    const rules = current.prefs.rules ?? [];

    if (input.op === "list") {
      return rules;
    }

    if (input.op === "add" && input.rule === undefined) {
      return yield* new FilterError({ reason: "add requires rule" });
    }

    if (input.op === "remove" && input.id === undefined) {
      return yield* new FilterError({ reason: "remove requires id" });
    }

    const next =
      input.op === "remove"
        ? rules.filter((rule) => rule.id !== input.id)
        : [...rules.filter((rule) => rule.id !== input.rule?.id), input.rule];

    const prefs = yield* Schema.decodeUnknownEffect(Prefs.Main)({
      ...current.prefs,
      rules: next,
    });

    const value = yield* change({ prefs: decimalPreferences(prefs) });

    return value.prefs.rules ?? [];
  }
);

export const filterLines = (
  rules: readonly Prefs.RuleValue[],
  hits: Readonly<Record<string, number>>,
  offset = 0,
  limit = 32
): readonly string[] => [
  `filters · ${rules.length}/32 · local hits`,
  ...rules
    .slice(offset, offset + limit)
    .map(
      (rule) =>
        `${rule.id} · ${rule.route}${rule.minutes === undefined ? "" : ` ${rule.minutes}m`} · hits ${hits[rule.id] ?? 0}\n  until ${(rule.until ?? "never").slice(0, 35)}\n  match ${JSON.stringify(rule.match).length > 96 ? `${JSON.stringify(rule.match).slice(0, 95)}…` : JSON.stringify(rule.match)}`
    ),
  ...(offset + limit < rules.length ? [`next offset ${offset + limit}`] : []),
];

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
          input.delegate !== undefined ||
          input.exempt !== undefined ||
          input.status !== undefined ||
          input.until !== undefined ||
          input.note !== undefined
        ) {
          const value = {
            $type: "sh.mschf.ratking.attention.status",
            state: input.status ?? status.state,
            version: "0.1",
          };

          if (value.state !== "available") {
            if (input.delegate !== undefined) {
              Object.assign(value, { delegate: input.delegate });
            }

            if (input.exempt !== undefined) {
              Object.assign(value, { exempt: input.exempt });
            }
          }

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
