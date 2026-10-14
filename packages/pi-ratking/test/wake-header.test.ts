import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { Schema } from "effect";
import { expect } from "vitest";

import { digestDetails, renderDigest } from "../src/extension.ts";
import { digestView } from "../src/notice-view.ts";
import { shownIds, WAKE_MESSAGE } from "../src/pending.ts";
import type { PendingMail } from "../src/pending.ts";
import { themes } from "./inline-fixtures.ts";

it.prop(
  "typed wake batches carry a wake reason, header, labelled status rows and display custody ids",
  [Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 }))],
  ([count]) => {
    const mails: PendingMail[] = Array.from({ length: count }, (_, index) => ({
      content: `Verbatim wake ${index}`,
      details: {
        body: `Verbatim wake ${index}`,
        from: "worker",
        id: String(index),
        summary: `Watch ${index} · matched`,
      },
      id: String(index),
      wake: true,
    }));

    const content = renderDigest("ratking", mails, "wake");

    const details = {
      ...digestDetails(mails, "wake"),
      messages: mails.map((mail) => mail.details),
    };

    expect(WAKE_MESSAGE).toBe("ratking_wake");
    expect(content).toContain(`**🐀 wake** · ${count}`);
    expect(details.reason.facts).toEqual(["wake"]);
    expect(content).not.toContain("cc digest");
    expect(
      shownIds({ customType: WAKE_MESSAGE, details, role: "custom" })
    ).toEqual(mails.map((mail) => mail.id));

    for (let index = 0; index < count; index += 1) {
      expect(content).toContain(`Watch ${index} · matched`);
    }

    for (const { theme } of themes) {
      const lines = digestView({ content, details, expanded: false, theme })
        .render(120)
        .map(stripTerminalSequences);

      const [header] = lines;

      expect(header).toContain(`wake · ${count}`);
      expect(header).not.toContain("cc digest");

      for (let index = 0; index < count; index += 1) {
        expect(lines.join("\n")).toContain(`Watch ${index} · matched`);
      }
    }
  }
);
