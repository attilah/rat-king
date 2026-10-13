import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { expect } from "vitest";

import { harness } from "../../../packages/pi-ratking/test/harness.ts";
import { parseDuration } from "../src/attention.ts";
import { runRatking } from "../src/main.ts";
import { Wiring } from "../src/session.ts";
import { captured, fakeMailbox, people, seeded } from "./fixture.ts";
import type { FakeAttention } from "./fixture.ts";

const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,8}$/u));

const List = Schema.Literals(["allow", "refuse", "forward"]);

const Kind = Schema.Literals(["message", "ask", "reply", "data"]);

const rich = (): FakeAttention => ({
  prefs: {
    allow: ["amy"],
    forward: [],
    log: true,
    model: {
      body: "full",
      jev: { judgment: "keep it short", laterBp: 2500, nowBp: 7500 },
      kind: "jev",
      timeoutMs: 45_000,
    },
    mute: [
      { $type: "sh.mschf.ratking.attention.prefs#thread", thread: "t-1" },
      { $type: "sh.mschf.ratking.attention.prefs#group", group: "g-1" },
    ],
    refuse: ["bob"],
    version: "0.1",
  },
  status: {
    $type: "sh.mschf.ratking.attention.status",
    state: "available",
    version: "0.1",
  },
});

const Lists = Schema.Record(Schema.String, Schema.Json);

const listOf = (prefs: Schema.Json, list: string) =>
  Schema.decodeUnknownSync(
    Schema.Struct({ [list]: Schema.Array(Schema.String) })
  )(prefs)[list] ?? [];

const without = (prefs: Schema.Json, list: string) => {
  const { [list]: _dropped, ...rest } = Schema.decodeUnknownSync(Lists)(prefs);

  return rest;
};

const WRITES = ["attention.putPreferences", "attention.putStatus"];

const session = (attention: FakeAttention) =>
  Effect.gen(function* open() {
    const fs = yield* FileSystem.FileSystem;
    const who = yield* people;
    const mailbox = fakeMailbox([], undefined, attention);

    const wiring = harness(
      yield* fs.makeTempDirectoryScoped(),
      mailbox.http,
      [],
      { attentionLevers: true, secrets: seeded(who) }
    );

    const run = (args: readonly string[]) => {
      const out = captured();

      return runRatking([...args, "--as", "tester", "--json"]).pipe(
        Effect.provideService(Console.Console, out.console),
        Effect.provideService(Wiring, wiring),
        Effect.map(() => out.stdout.join("\n"))
      );
    };

    return { mailbox, run };
  });

const writes = (calls: readonly { readonly nsid: string }[]) =>
  calls.filter((call) => WRITES.some((write) => call.nsid.endsWith(write)));

it.live.prop(
  "name lists add and remove against a model while the rest of the stored preferences stay byte for byte, probabilities included",
  [List, Name, Name],
  ([list, added, other]) =>
    Effect.gen(function* lists() {
      const attention = rich();
      const { mailbox, run } = yield* session(attention);
      const before = structuredClone(attention.prefs);
      const start = listOf(before, list);

      yield* run(["attention", list, added, other]);

      const grown = [...new Set([...start, added, other])];

      expect(listOf(attention.prefs, list)).toEqual(grown);
      expect(without(attention.prefs, list)).toEqual(without(before, list));

      yield* run(["attention", list, added, "--remove"]);

      expect(listOf(attention.prefs, list)).toEqual(
        grown.filter((held) => held !== added)
      );
      expect(without(attention.prefs, list)).toEqual(without(before, list));
      expect(writes(mailbox.calls).length).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 12 }, timeout: 60_000 }
);

it.live.prop(
  "attention test writes neither preferences nor status and leaves the stored levers untouched, whatever the arrival and the do-not-disturb state",
  [Kind, Schema.Boolean, Schema.Boolean, Name],
  ([kind, cc, dnd, from]) =>
    Effect.gen(function* dryRun() {
      const attention = rich();

      if (dnd) {
        attention.status = {
          $type: "sh.mschf.ratking.attention.status",
          state: "dnd",
          until: "2099-01-01T00:00:00.000Z",
          version: "0.1",
        };
      }

      const snapshot = structuredClone(attention);
      const { mailbox, run } = yield* session(attention);

      const text = yield* run([
        "attention",
        "test",
        "--from",
        from,
        "--kind",
        kind,
        ...(cc ? ["--cc"] : []),
      ]);

      const document = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({ ok: Schema.Boolean, verdict: Schema.String })
        )
      )(text);

      expect(document.ok).toBe(true);
      expect(writes(mailbox.calls)).toEqual([]);
      expect(attention).toEqual(snapshot);
      expect(
        dnd && !cc && from !== "amy" ? document.verdict === "Later" : true
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 12 }, timeout: 60_000 }
);

it.live.prop(
  "parseDuration reads <n><unit> as milliseconds and refuses anything else",
  [
    Schema.Int.check(Schema.isBetween({ maximum: 999, minimum: 1 })),
    Schema.Literals(["s", "m", "h", "d"]),
  ],
  ([count, unit]) =>
    Effect.sync(() => {
      const scale = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };

      expect(Option.getOrNull(parseDuration(`${count}${unit}`))).toBe(
        count * scale[unit]
      );
      expect(parseDuration(`${count}`)._tag).toBe("None");
      expect(parseDuration(`${count}${unit}x`)._tag).toBe("None");
      expect(parseDuration(`0${unit}`)._tag).toBe("None");
    })
);
