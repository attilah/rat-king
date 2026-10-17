import { it } from "@effect/vitest";
import { Transport } from "@rat-king/lexicon/transport";
import {
  healthVerdict,
  readMailboxHealth,
} from "@rat-king/mailbox-client/health";
import type { HealthFacts } from "@rat-king/mailbox-client/health";
import { Effect, Schema } from "effect";
import { expect } from "vitest";

import { Text } from "../../../packages/pi-ratking/src/ui/text.ts";
import { healthScreen } from "../src/health.ts";
import { healthFixture, healthNow } from "./health-fixture.ts";

it.effect.prop(
  "health adapter makes exactly one read for one name and refuses non-operator responses",
  [Schema.Boolean],
  ([allowed]) =>
    Effect.gen(function* readOnly() {
      const calls: string[] = [];

      const transport = Transport.of({
        request: (request) =>
          Effect.sync(() => {
            calls.push(`${request.method} ${request.nsid}`);
            expect(request.params).toEqual({
              name: "sample/worker",
              recipientDid: "did:web:worker.example.invalid",
            });

            return allowed
              ? {
                  body: { complete: true, quietUnacked: 0 },
                  kind: "json" as const,
                  status: 200,
                }
              : {
                  body: { error: "Forbidden" },
                  kind: "json" as const,
                  status: 403,
                };
          }),
      });

      const result = yield* readMailboxHealth(
        transport,
        "did:web:worker.example.invalid",
        "sample/worker"
      ).pipe(Effect.result);

      expect(calls).toEqual(["GET sh.mschf.ratking.mailbox.nameHealth"]);
      expect(result._tag).toBe(allowed ? "Success" : "Failure");
    })
);

const verdicts: readonly {
  readonly change: Partial<HealthFacts>;
  readonly expected: string;
}[] = [
  { change: {}, expected: "agent not taking turns" },
  { change: { reader: "stuck" }, expected: "reader stuck" },
  { change: { lease: null }, expected: "unknown (lease unavailable)" },
  {
    change: {
      lease: {
        expiresAt: healthNow,
        generation: 7,
        holder: "session",
        pane: null,
      },
    },
    expected: "unknown (lease expired)",
  },
  {
    change: {
      oldestWake: {
        ...healthFixture.oldestWake,
        at: healthNow - 180_000,
        id: "3m7x2ka4xv22a",
        sender: "sample/desk",
      },
    },
    expected: "ok",
  },
  { change: { oldestWake: null }, expected: "ok" },
  {
    change: { oldestWake: null, reader: "unknown" },
    expected: "unknown (reader unavailable)",
  },
  {
    change: { complete: false, oldestWake: null },
    expected:
      "unknown (mailbox snapshot incomplete or receipt missing wake/time)",
  },
];

it.prop(
  "health verdict table keeps the strict three-minute threshold, lease gate, reader precedence and unknown evidence",
  [
    Schema.Int.check(
      Schema.isBetween({ maximum: verdicts.length - 1, minimum: 0 })
    ),
  ],
  ([index]) => {
    const row = verdicts[index];

    expect(row).toBeDefined();

    if (row !== undefined) {
      expect(
        healthVerdict({ ...healthFixture, ...row.change }, healthNow)
      ).toBe(row.expected);
    }
  }
);

it.prop(
  "fixture screen fits one screen at supported widths and owns one health header",
  [Schema.Literals([40, 60, 80, 120])],
  ([width]) => {
    const lines = healthScreen(
      "sample/worker",
      healthFixture,
      healthNow,
      width
    );

    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe("🐀 health sample/worker");
    expect(lines.filter((line) => line.includes("🐀"))).toHaveLength(1);
    expect(lines.every((line) => Text({ text: line, width }) === line)).toBe(
      true
    );
    expect(lines.join("\n")).toContain("verdict: agent not taking turns");
    expect(lines.join("\n")).toContain("3m7x2ka4xv22a");
    expect(lines.join("\n")).toContain("181s");
    expect(lines.join("\n")).toContain("quiet copies unacked: 4");
  }
);
