import { it } from "@effect/vitest";
import {
  AskFailed,
  LeaseHeld,
  NotDelivered,
} from "@rat-king/ratking-client/ratking";
import { Schema } from "effect";
import { expect } from "vitest";

import { faulted, promptText } from "../src/faults.ts";
import type { Fault } from "../src/faults.ts";

const Reason = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9 ,.]{0,60}$/u)
);

it.prop(
  "every refusal renders as the literal prompt in order: Tag with why, Accepted, Fix, Debug",
  [
    Schema.Literals([
      "NoIdentity",
      "UnknownName",
      "Self",
      "NotAttempted",
      "Rejected",
      "Uncertain",
      "Refused",
      "Partial",
      "Retired",
      "ReaderCannotRender",
    ]),
    Schema.Literals(["NoReply", "NoReader", "NoSuchMessage"]),
    Reason,
  ],
  ([code, askCode, reason]) => {
    const faults: readonly Fault[] = [
      new NotDelivered({ code, reason }),
      new AskFailed({ code: askCode, reason }),
      new LeaseHeld({
        expiresAt: "2099-01-01T00:00:00.000Z",
        harness: "pi",
        holder: reason,
        name: "tester",
        reason: "held",
      }),
    ];

    for (const fault of faults) {
      const { prompt } = faulted(fault, { as: "tester", to: "peer" });
      const lines = promptText(prompt).split("\n");

      expect(lines).toHaveLength(4);
      expect(lines[0]?.startsWith(`${prompt.tag}: `)).toBe(true);
      expect(lines[0]).toContain(prompt.why);
      expect(lines[1]?.startsWith("Accepted: ")).toBe(true);
      expect(lines[2]?.startsWith("Fix: ")).toBe(true);
      expect(lines[3]?.startsWith("Debug: ")).toBe(true);
    }
  }
);
