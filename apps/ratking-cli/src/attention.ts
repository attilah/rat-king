import { attend, formatReason } from "@rat-king/ratking-client/attend";
import type { Arrival, Verdict } from "@rat-king/ratking-client/attend";
import {
  decimalPreferences,
  ToolPreferences,
} from "@rat-king/ratking-client/attention";
import type { ToolPreferencesValue } from "@rat-king/ratking-client/attention";
import { Inbox } from "@rat-king/ratking-client/ratking";
import type { Attached } from "@rat-king/ratking-client/ratking";
import { Clock, DateTime, Effect, Option, Predicate, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { Usage } from "./faults.ts";
import type { Report } from "./output.ts";
import { withField } from "./output.ts";
import { commonFlags, named, toggle } from "./session.ts";

const UNITS = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1000],
] as const;

const DURATION = /^(?<count>\d+)(?<unit>[smhd])$/u;

export const parseDuration = (text: string): Option.Option<number> => {
  const found = DURATION.exec(text.trim());
  const count = found?.groups?.count;
  const scale = UNITS.find(([unit]) => unit === found?.groups?.unit)?.[1];

  if (count === undefined || scale === undefined) {
    return Option.none();
  }

  const millis = Number(count) * scale;

  return millis > 0 ? Option.some(millis) : Option.none();
};

type Mute = ToolPreferencesValue["mute"][number];

const same = (left: Mute, right: Mute) =>
  JSON.stringify(left) === JSON.stringify(right);

const usage = (reason: string, accepted: string, fix: string) =>
  new Usage({ accepted, fix, reason });

const decimalOf = Effect.fn("RatkingCli.decimalOf")(function* decimalOf() {
  const inbox = yield* Inbox;
  const current = yield* inbox.levers;

  return {
    current,
    prefs: yield* Schema.decodeUnknownEffect(ToolPreferences)(
      decimalPreferences(current.prefs)
    ).pipe(
      Effect.mapError((failure) =>
        usage(
          `Stored preferences do not decode: ${failure.message}`,
          "preferences in the shape the mailbox stores",
          "ratking attention show"
        )
      )
    ),
  };
});

const rewrite = Effect.fn("RatkingCli.rewrite")(function* rewrite(
  edit: (prefs: ToolPreferencesValue) => ToolPreferencesValue
) {
  const inbox = yield* Inbox;
  const { prefs } = yield* decimalOf();

  return yield* inbox.change({ prefs: edit(prefs) });
});

const statusLine = (
  name: string,
  state: string,
  until?: string,
  note?: string
) =>
  [
    `🐀 attention ${name}`,
    state,
    ...(until === undefined ? [] : [`until ${until}`]),
    ...(note === undefined ? [] : [note]),
  ].join(" · ");

const prefsLine = (prefs: ToolPreferencesValue) =>
  [
    `allow ${prefs.allow.join(",") || "-"}`,
    `refuse ${prefs.refuse.join(",") || "-"}`,
    `forward ${prefs.forward.join(",") || "-"}`,
    `mute ${prefs.mute.length}`,
    `model ${prefs.model.kind}/${prefs.model.body}`,
    `log ${prefs.log ? "on" : "off"}`,
  ].join(" · ");

const shown = (me: Attached, prefs: ToolPreferencesValue, status: Status) =>
  ({
    document: { name: me.name, prefs, status },
    lines: [
      statusLine(me.name, status.state, status.until, status.note),
      `  ${prefsLine(prefs)}`,
    ],
  }) satisfies Report;

interface Status {
  readonly note?: string | undefined;
  readonly state: string;
  readonly until?: string | undefined;
}

const showCommand = Command.make(
  "show",
  { ...commonFlags, of: Flag.String("of").pipe(Flag.optional) },
  (args) =>
    named("attention show", args, (me) =>
      Effect.gen(function* show() {
        const inbox = yield* Inbox;

        if (Option.isSome(args.of)) {
          const status = yield* inbox.statusOf(args.of.value);

          return {
            document: { name: args.of.value, status },
            lines: [
              statusLine(
                args.of.value,
                status.state,
                status.until,
                status.note
              ),
            ],
          } satisfies Report;
        }

        const { current, prefs } = yield* decimalOf();

        return {
          ...shown(me, prefs, current.status),
          document: {
            enabled: current.enabled,
            name: me.name,
            prefs,
            status: current.status,
          },
        } satisfies Report;
      })
    )
).pipe(
  Command.withDescription(
    "Show your status and preferences, or --of <name> for another name's public status."
  )
);

const changed = (me: Attached, value: { prefs: unknown; status: Status }) =>
  ({
    document: { name: me.name, ...value },
    lines: [
      statusLine(
        me.name,
        value.status.state,
        value.status.until,
        value.status.note
      ),
    ],
  }) satisfies Report;

const dndCommand = Command.make(
  "dnd",
  {
    ...commonFlags,
    duration: Argument.String("duration"),
    note: Flag.String("note").pipe(Flag.optional),
  },
  (args) =>
    named("attention dnd", args, (me) =>
      Effect.gen(function* dnd() {
        const inbox = yield* Inbox;

        const span = parseDuration(args.duration);

        if (Option.isNone(span)) {
          return yield* usage(
            `${args.duration} is not a duration`,
            "<n>s, <n>m, <n>h or <n>d, for example 90m",
            "ratking attention dnd 2h"
          );
        }

        const at = yield* Clock.currentTimeMillis;

        const until = DateTime.formatIso(DateTime.makeUnsafe(at + span.value));

        const value = yield* inbox.change(
          withField(
            { status: "dnd" as const, until },
            "note",
            Option.getOrUndefined(args.note)
          )
        );

        return changed(me, value);
      })
    )
).pipe(
  Command.withDescription(
    "Set do-not-disturb for a duration (90m, 2h, 1d); mail is held until it ends."
  )
);

const availableCommand = Command.make("available", commonFlags, (args) =>
  named("attention available", args, (me) =>
    Effect.gen(function* available() {
      const inbox = yield* Inbox;

      return changed(me, yield* inbox.change({ status: "available" }));
    })
  )
).pipe(Command.withDescription("Mark yourself available."));

const names = Argument.String("name").pipe(Argument.variadic());

type NameList = "allow" | "forward" | "refuse";

const nameList = (list: NameList, summary: string) =>
  Command.make(
    list,
    { ...commonFlags, names, remove: toggle("remove") },
    (args) =>
      named(`attention ${list}`, args, (me) =>
        Effect.gen(function* edit() {
          const value = yield* rewrite((prefs) => ({
            ...prefs,
            [list]: args.remove
              ? prefs[list].filter((held) => !args.names.includes(held))
              : [...new Set([...prefs[list], ...args.names])],
          }));

          return {
            document: { name: me.name, [list]: value.prefs },
            lines: [`🐀 attention ${me.name} · ${list} updated`],
          } satisfies Report;
        })
      )
  ).pipe(Command.withDescription(summary));

const muteCommand = Command.make(
  "mute",
  {
    ...commonFlags,
    group: Flag.String("group").pipe(Flag.optional),
    remove: toggle("remove"),
    thread: Flag.String("thread").pipe(Flag.optional),
  },
  (args) =>
    named("attention mute", args, (me) =>
      Effect.gen(function* mute() {
        if (Option.isNone(args.thread) && Option.isNone(args.group)) {
          return yield* usage(
            "Nothing to mute",
            "--thread <ref> or --group <ref>",
            "ratking attention mute --thread <thread-id>"
          );
        }

        const entries = [
          ...Option.match(args.thread, {
            onNone: () => [],
            onSome: (thread) => [
              {
                $type: "sh.mschf.ratking.attention.prefs#thread" as const,
                thread,
              },
            ],
          }),
          ...Option.match(args.group, {
            onNone: () => [],
            onSome: (group) => [
              {
                $type: "sh.mschf.ratking.attention.prefs#group" as const,
                group,
              },
            ],
          }),
        ];

        yield* rewrite((prefs) => ({
          ...prefs,
          mute: args.remove
            ? prefs.mute.filter(
                (held) => !entries.some((entry) => same(entry, held))
              )
            : [
                ...prefs.mute,
                ...entries.filter(
                  (entry) => !prefs.mute.some((held) => same(entry, held))
                ),
              ],
        }));

        return {
          document: { mute: entries, name: me.name, removed: args.remove },
          lines: [`🐀 attention ${me.name} · mute updated`],
        } satisfies Report;
      })
    )
).pipe(Command.withDescription("Mute a thread or group (--remove to unmute)."));

const setCommand = Command.make(
  "set",
  {
    ...commonFlags,
    body: Flag.Literals("body", ["never", "summary", "full"]).pipe(
      Flag.optional
    ),
    judgment: Flag.String("judgment").pipe(Flag.optional),
    later: Flag.Finite("later").pipe(Flag.optional),
    model: Flag.Literals("model", ["none", "jev"]).pipe(Flag.optional),
    now: Flag.Finite("now").pipe(Flag.optional),
    timeoutMs: Flag.Int("timeout-ms").pipe(Flag.optional),
  },
  (args) =>
    named("attention set", args, (me) =>
      Effect.gen(function* set() {
        const value = yield* rewrite((prefs) => {
          const { jev: held, ...rest } = prefs.model;
          const kind = Option.getOrElse(args.model, () => prefs.model.kind);

          const jev = {
            judgment: Option.getOrElse(
              args.judgment,
              () => held?.judgment ?? "unspecified"
            ),
            later: Option.getOrElse(args.later, () => held?.later ?? 0),
            now: Option.getOrElse(args.now, () => held?.now ?? 0),
          };

          const model = {
            ...rest,
            body: Option.getOrElse(args.body, () => prefs.model.body),
            kind,
            timeoutMs: Option.getOrElse(
              args.timeoutMs,
              () => prefs.model.timeoutMs
            ),
          };

          return {
            ...prefs,
            model: kind === "jev" ? { ...model, jev } : model,
          };
        });

        return {
          document: { name: me.name, prefs: value.prefs },
          lines: [`🐀 attention ${me.name} · model updated`],
        } satisfies Report;
      })
    )
).pipe(
  Command.withDescription(
    "Set the judging model: --model none|jev, --body never|summary|full, --now/--later 0..1, --judgment, --timeout-ms."
  )
);

const verdictFields = (verdict: Verdict) => ({
  facts: verdict.reason.facts,
  reason: formatReason(verdict.reason),
  verdict: verdict._tag,
  window: Predicate.isTagged(verdict, "Later") ? verdict.window : null,
});

const testCommand = Command.make(
  "test",
  {
    ...commonFlags,
    cc: toggle("cc"),
    from: Flag.String("from").pipe(Flag.optional),
    group: Flag.String("group").pipe(Flag.optional),
    kind: Flag.Literals("kind", ["message", "ask", "reply", "data"]).pipe(
      Flag.withDefault("message")
    ),
    message: Flag.String("message").pipe(Flag.optional),
    thread: Flag.String("thread").pipe(Flag.optional),
  },
  (args) =>
    named("attention test", args, (me) =>
      Effect.gen(function* attentionTest() {
        const inbox = yield* Inbox;
        const stored = yield* inbox.levers;
        const levers = { ...stored, enabled: true };
        const at = yield* Clock.currentTimeMillis;

        const peeked = Option.isSome(args.message)
          ? yield* inbox.peek({ all: true })
          : { messages: [] };

        const found = peeked.messages.find(
          (entry) =>
            Option.isSome(args.message) &&
            entry.received.id.startsWith(args.message.value)
        );

        if (Option.isSome(args.message) && found === undefined) {
          return yield* usage(
            `No message ${args.message.value} in ${me.name}'s mailbox`,
            "an id or id prefix from ratking inbox --all",
            "ratking inbox --all"
          );
        }

        const received = found?.received;

        const arrival: Arrival =
          received !== undefined && !("record" in received)
            ? withField(
                withField(
                  withField(
                    withField(
                      {
                        kind: received.kind,
                        verified: received.verified,
                      } satisfies Arrival,
                      "from",
                      received.from
                    ),
                    "copy",
                    received.cc
                  ),
                  "sender",
                  received.sender
                ),
                "thread",
                received.thread
              )
            : withField(
                withField(
                  withField(
                    {
                      copy: args.cc,
                      kind: args.kind,
                      verified: true,
                    } satisfies Arrival,
                    "from",
                    Option.getOrUndefined(args.from)
                  ),
                  "thread",
                  Option.getOrUndefined(args.thread)
                ),
                "group",
                Option.getOrUndefined(args.group)
              );

        const verdict = attend(arrival, levers, at, undefined, Option.none());

        return {
          document: {
            arrival,
            enabled: stored.enabled,
            name: me.name,
            ...verdictFields(verdict),
          },
          lines: [
            `🐀 attention test ${me.name} · ${verdict._tag} · ${formatReason(verdict.reason)}${stored.enabled ? "" : " · reader levers are off (RATKING_ATTENTION unset): a running reader ignores this verdict"}`,
          ],
        } satisfies Report;
      })
    )
).pipe(
  Command.withDescription(
    "Dry-run the attend verdict for a stored message (--message <id>) or a described arrival (--from, --kind, --cc, --thread, --group). Reads your levers, writes nothing."
  )
);

const logCommand = Command.make(
  "log",
  {
    ...commonFlags,
    state: Argument.Literals("state", ["on", "off"]).pipe(Argument.optional),
  },
  (args) =>
    named("attention log", args, (me) =>
      Effect.gen(function* log() {
        const { prefs } = yield* decimalOf();

        if (Option.isNone(args.state)) {
          return {
            document: {
              log: prefs.log,
              name: me.name,
              outcomes: "not recorded",
            },
            lines: [
              `🐀 attention ${me.name} · log ${prefs.log ? "on" : "off"} · no outcome store exists yet, so no outcomes are listed`,
            ],
          } satisfies Report;
        }

        const on = args.state.value === "on";
        const value = yield* rewrite((held) => ({ ...held, log: on }));

        return {
          document: { log: value.prefs, name: me.name },
          lines: [`🐀 attention ${me.name} · log ${on ? "on" : "off"}`],
        } satisfies Report;
      })
    )
).pipe(
  Command.withDescription(
    "Show or set the log preference. Outcomes are not stored anywhere yet; this only toggles the flag."
  )
);

export const attentionCommand = Command.make("attention").pipe(
  Command.withDescription(
    "Read and change your attention levers: status, do-not-disturb, allow/refuse/forward lists, mutes, the judging model. test is read-only."
  ),
  Command.withSubcommands([
    showCommand,
    setCommand,
    dndCommand,
    availableCommand,
    nameList("allow", "Always wake for these names (--remove to drop)."),
    nameList("refuse", "Drop mail from these names (--remove to drop)."),
    nameList("forward", "Forward your mail to these names (--remove to drop)."),
    muteCommand,
    testCommand,
    logCommand,
  ])
);
