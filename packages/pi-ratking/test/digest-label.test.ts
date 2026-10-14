import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { attend } from "@rat-king/ratking-client/attend";
import { Option, Schema } from "effect";
import { expect } from "vitest";

import { defaultPreferences } from "../../mailbox-client/src/attention.ts";
import { digestDetails, renderDigest } from "../src/extension.ts";
import { digestView } from "../src/notice-view.ts";
import type { PendingMail } from "../src/pending.ts";
import { themes } from "./inline-fixtures.ts";

it.prop(
  "digest headers follow verdict reasons: cc intent, direct lever and mixed batches in model content and TUI",
  [
    Schema.Literals(["cc", "lever", "mixed"]),
    Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 2 })),
  ],
  ([kind, count]) => {
    const mails: PendingMail[] = Array.from({ length: count }, (_, index) => {
      const direct = kind === "lever" || (kind === "mixed" && index === 0);

      const verdict = attend(
        {
          copy: !direct,
          digestMinutes: 1,
          from: "worker",
          kind: "message",
          verified: true,
        },
        direct
          ? {
              enabled: true,
              prefs: {
                ...defaultPreferences(),
                digest: [{ minutes: 1, name: "worker" }],
              },
            }
          : {},
        0,
        undefined,
        Option.none()
      );

      expect(verdict._tag).toBe("Later");

      return {
        content: "Mail",
        details: { body: "Mail", from: "worker", id: String(index) },
        id: String(index),
        line: `- worker · ${index}`,
        reason: verdict.reason,
      };
    });

    const expected = kind === "cc" ? "cc digest" : "digest";
    const content = renderDigest("ratking", mails);

    const details = {
      ...digestDetails(mails),
      messages: mails.map((mail) => mail.details),
    };

    expect(content).toContain(`**🐀 ${expected}** · ${count}`);

    if (kind !== "cc") {
      expect(content).not.toContain("cc digest");
      expect(content).not.toContain("These are copies");
    }

    for (const { theme } of themes) {
      for (const expanded of [false, true]) {
        const [header] = digestView({
          content,
          details,
          expanded,
          theme,
        }).render(100);

        expect(header).toBeDefined();
        expect(stripTerminalSequences(header ?? "")).toContain(
          `${expected} · ${count}`
        );

        if (kind !== "cc") {
          expect(stripTerminalSequences(header ?? "")).not.toContain(
            "cc digest"
          );
        }
      }
    }
  }
);
