import { it } from "@effect/vitest";
import {
  AskFailed,
  LeaseHeld,
  NotDelivered,
} from "@rat-king/ratking-client/ratking";
import { Console, Effect, Match, Schema } from "effect";
import { expect } from "vitest";

import { faulted } from "../src/faults.ts";
import type { Fault } from "../src/faults.ts";
import { refuse } from "../src/output.ts";
import { captured } from "./fixture.ts";

const KINDS = ["uncertain", "rejected", "held", "ask"] as const;

type Kind = (typeof KINDS)[number];

const Reason = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9 ,.]{0,60}$/u)
);

const faultOf = (kind: Kind, reason: string): Fault =>
  Match.value(kind).pipe(
    Match.when(
      "uncertain",
      () => new NotDelivered({ code: "Uncertain", reason })
    ),
    Match.when(
      "rejected",
      () => new NotDelivered({ code: "Rejected", reason })
    ),
    Match.when(
      "held",
      () =>
        new LeaseHeld({
          expiresAt: "2099-01-01T00:00:00.000Z",
          harness: "pi",
          holder: reason,
          name: "tester",
          reason: "held",
        })
    ),
    Match.when("ask", () => new AskFailed({ code: "NoReply", reason })),
    Match.exhaustive
  );

it.effect.prop(
  "every nonzero exit, with or without --json, prints one stderr prompt naming what failed, why and the next command, and keeps its exit code",
  [Schema.Boolean, Schema.Literals(KINDS), Reason],
  ([json, kind, reason]) =>
    Effect.gen(function* refusalReason() {
      const fault = faultOf(kind, reason);

      const out = captured();

      yield* refuse(json, "inbox", { as: "tester" }, fault).pipe(
        Effect.provideService(Console.Console, out.console)
      );

      const { exitCode: code } = process;
      process.exitCode = undefined;

      const stderr = out.stderr.join("\n");

      expect(code).toBe(faulted(fault, { as: "tester" }).code);
      expect([2, 3, 4]).toContain(code);
      expect(stderr.length).toBeGreaterThan(0);
      expect(stderr).toContain("Fix: ");
      expect(stderr).toContain(reason.slice(0, 20));
    })
);
