import { it } from "@effect/vitest";
import {
  Console,
  DateTime,
  Effect,
  FileSystem,
  Match,
  Schema,
  Stream,
} from "effect";
import { expect } from "vitest";

import {
  decodeTrafficLine,
  Unavailable,
  usageCommand,
  usageDigest,
} from "../../../stacks/nest/usage.ts";
import type { TrafficEvent } from "../../../stacks/nest/usage.ts";

const day = "2026-10-12";

const senderDid = "did:web:fixture.sender.pi.fleet.invalid";

const event = (
  messageId: string,
  recipientDid: string,
  state: TrafficEvent["state"],
  time: string
): TrafficEvent => ({
  messageId,
  recipientDid,
  recipientSeq: 1,
  senderDid,
  seq: 1,
  state,
  time,
});

const at = (ms: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(Date.parse(`${day}T00:00:00Z`) + ms));

const lines = (events: readonly TrafficEvent[]) =>
  Stream.fromIterable(
    events.map((value) =>
      JSON.stringify({ ...value, ciphertextSize: 987_654_321 })
    )
  ).pipe(Stream.mapEffect(decodeTrafficLine));

const fixture = [
  event("cc-one", "one", "accepted", at(0)),
  event("cc-two", "two", "accepted", at(0)),
  event("cc-one", "one", "queued", at(10)),
  event("cc-one", "one", "delivered", at(20)),
  event("cc-two", "two", "delivered", at(30)),
  event("cc-one", "one", "acked", at(100)),
  event("cc-two", "two", "acked", at(200)),
  event("cc-one", "one", "delivered", at(250)),
  event("pending", "one", "accepted", at(300)),
  event("pending", "one", "delivered", "2026-10-13T00:00:00Z"),
];

const expected = {
  ackLatency: { p50: 100, p95: 200 },
  acked: 2,
  ccRatio: Unavailable.make({
    source: "traffic export gives each cc copy its own messageId",
  }),
  day,
  delivered: 3,
  refusals: Unavailable.make({
    source: "traffic export carries no refusal metadata",
  }),
  replays: 1,
  replaysPerRestart: 1,
  restarts: 1,
  sent: 3,
  topSenders: [{ count: 3, did: senderDid, name: "fixture/sender" }],
  trims: Unavailable.make({
    source: "traffic export carries no trim metadata",
  }),
  undelivered: 1,
};

it.effect(
  "prints exact metadata-only JSON with a cc, replay, undelivered pair and restart",
  () =>
    Effect.gen(function* fixtureDigest() {
      const output: string[] = [];
      const start = Date.parse(`${day}T00:00:00Z`) / 1000;

      const files = new Map([
        [
          "traffic",
          fixture
            .map((value) =>
              JSON.stringify({ ...value, ciphertextSize: 987_654_321 })
            )
            .join("\n"),
        ],
        [
          "receipts",
          [
            {
              celldRestarted: true,
              end: 1_791_847_436.46,
              restartSeconds: 56.818179,
              result: "success",
              sha: "0123456789abcdef0123456789abcdef01234567",
              start: 1_791_847_269.549,
              stderrTail: "private receipt details",
            },
            { celldRestarted: false, end: start + 1 },
            { celldRestarted: true, end: start + 86_400 },
            {
              celldRestarted: true,
              end: 1_791_854_500.5,
              restartSeconds: 12.4,
              result: "success",
              sha: "0123456789abcdef0123456789abcdef01234567",
              start: 1_791_854_480.1,
            },
          ]
            .map((value) => JSON.stringify(value))
            .join("\n"),
        ],
      ]);

      yield* usageCommand([
        "--day",
        day,
        "--input",
        "traffic",
        "--restarts",
        "receipts",
      ]).pipe(
        Effect.provide(
          FileSystem.layerNoop({
            stream: (path) =>
              Stream.fromIterable(
                [...new TextEncoder().encode(files.get(path) ?? "")].map(
                  (byte) => Uint8Array.of(byte)
                )
              ),
          })
        ),
        Effect.provideService(Console.Console, {
          ...console,
          log: (...args: readonly unknown[]) => {
            output.push(args.join(" "));
          },
        })
      );
      expect(output).toEqual([JSON.stringify(expected)]);
    })
);

it.effect.prop(
  "forbidden plants refuse with only field and sequence, never their values",
  [
    Schema.Literals(["body", "ciphertext", "summary", "message"]),
    Schema.String,
  ],
  ([field, secret]) =>
    Effect.gen(function* forbiddenPlant() {
      const error = yield* decodeTrafficLine(
        JSON.stringify({
          ...fixture[0],
          [field]: secret,
          ciphertextSize: secret,
        })
      ).pipe(Effect.flip);

      expect(error._tag).toBe("ForbiddenField");
      expect(error).toMatchObject({ field, seq: 1 });
      expect(Object.keys(error).toSorted()).toEqual(["_tag", "field", "seq"]);
    })
);

it.effect.prop(
  "excess keys, malformed JSON and metadata fail without input in diagnostics",
  [Schema.Literals(["excess", "json", "metadata"])],
  ([mutation]) =>
    Effect.gen(function* safeDiagnostics() {
      const secret = "PRIVATE_VALUE_987654321";

      const line =
        mutation === "json"
          ? `{"${secret}"`
          : JSON.stringify({
              ...fixture[0],
              ...(mutation === "excess" ? { extra: secret } : { seq: secret }),
            });

      const error = yield* decodeTrafficLine(line).pipe(Effect.flip);
      expect(error._tag).toBe("FleetError");
      expect(JSON.stringify(error)).not.toContain(secret);
    })
);

const Scenario = Schema.Struct({
  ack: Schema.Boolean,
  deliveries: Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 0 })),
  latency: Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: 1 })),
  recipients: Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 1 })),
});

it.effect.prop(
  "generated message lifecycles preserve counts, quantiles, cc and metadata privacy in either order",
  [Schema.Array(Scenario), Schema.Boolean],
  ([scenarios, reverse]) =>
    Effect.gen(function* lifecycleLaws() {
      const events = scenarios.flatMap((scenario, index) =>
        Array.from({ length: scenario.recipients }, (_, recipient) => {
          const messageId = `message-${index}-${recipient}`;
          const target = `recipient-${recipient}`;

          return [
            event(messageId, target, "accepted", at(0)),
            ...Array.from(
              { length: scenario.deliveries },
              (_delivery, replay) =>
                event(messageId, target, "delivered", at(replay + 1))
            ),
            ...(scenario.ack && scenario.deliveries > 0
              ? [event(messageId, target, "acked", at(scenario.latency + 4))]
              : []),
          ];
        }).flat()
      );

      const digest = yield* usageDigest(
        day,
        lines(reverse ? events.toReversed() : events)
      );

      expect(digest.sent).toBe(
        scenarios.reduce((sum, scenario) => sum + scenario.recipients, 0)
      );
      expect(digest.delivered).toBe(
        scenarios.reduce(
          (sum, scenario) => sum + scenario.recipients * scenario.deliveries,
          0
        )
      );
      expect(digest.acked).toBe(
        scenarios.reduce(
          (sum, scenario) =>
            sum +
            (scenario.ack && scenario.deliveries > 0 ? scenario.recipients : 0),
          0
        )
      );
      expect(digest.acked).toBeLessThanOrEqual(digest.delivered);
      expect(digest.replays).toBe(
        scenarios.reduce(
          (sum, scenario) =>
            sum + scenario.recipients * Math.max(0, scenario.deliveries - 1),
          0
        )
      );
      expect(digest.undelivered).toBe(
        scenarios.reduce(
          (sum, scenario) =>
            sum + (scenario.deliveries === 0 ? scenario.recipients : 0),
          0
        )
      );
      expect(digest.ccRatio).toEqual(expected.ccRatio);
      expect(digest.replaysPerRestart).toBeNull();

      if (digest.ackLatency.p50 !== null && digest.ackLatency.p95 !== null) {
        expect(digest.ackLatency.p50).toBeLessThanOrEqual(
          digest.ackLatency.p95
        );
      } else {
        expect(digest.ackLatency).toEqual({ p50: null, p95: null });
      }

      const json = JSON.stringify(digest);
      expect(json).not.toMatch(
        /"(?:body|ciphertext|summary|message|ciphertextSize)":/u
      );
      expect(json).not.toContain("987654321");
    })
);

it.effect(
  "joins previous-day acceptance and delivery without counting them as today's events",
  () =>
    Effect.gen(function* previousDayJoins() {
      const digest = yield* usageDigest(
        day,
        lines([
          event("old", "one", "accepted", "2026-10-11T23:59:59Z"),
          event("old", "one", "delivered", "2026-10-11T23:59:59.500Z"),
          event("old", "one", "delivered", at(100)),
          event("old", "one", "acked", at(200)),
        ])
      );

      expect(digest).toMatchObject({
        ackLatency: { p50: 1200, p95: 1200 },
        acked: 1,
        delivered: 1,
        replays: 1,
        sent: 0,
        undelivered: 0,
      });
    })
);

it.effect.prop(
  "invalid days and malformed or duplicate flags refuse before file access",
  [Schema.Literals(["date", "missing", "unknown", "duplicate"])],
  ([mutation]) =>
    Effect.gen(function* refusedFlags() {
      const args = Match.value(mutation).pipe(
        Match.when("date", () => ["--day", "2026-02-30", "--input", "traffic"]),
        Match.when("missing", () => ["--day", day]),
        Match.when("unknown", () => ["--extra", "secret"]),
        Match.when("duplicate", () => [
          "--day",
          day,
          "--day",
          day,
          "--input",
          "traffic",
        ]),
        Match.exhaustive
      );

      const error = yield* usageCommand(args).pipe(
        Effect.provide(FileSystem.layerNoop({})),
        Effect.flip
      );

      expect(error._tag).toBe("FleetError");
    })
);
