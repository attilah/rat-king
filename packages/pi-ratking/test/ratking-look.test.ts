import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { COPY_NOTE, renderInbound } from "@rat-king/ratking-client/payload";
import type { Inbound } from "@rat-king/ratking-client/payload";
import { NotDelivered, ReaderState } from "@rat-king/ratking-client/ratking";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import {
  digestDetails,
  digestLine,
  inboundDetails,
  renderDigest,
} from "../src/extension.ts";
import { inboundLines } from "../src/message-view.ts";
import { digestView, recordView } from "../src/notice-view.ts";
import { callView, resultView } from "../src/tool-view.ts";
import { notDeliveredText, receiptText, statusText } from "../src/tool.ts";
import { noLabels, party, roleColour, roleOf } from "../src/tui.ts";
import {
  ansiTheme,
  assertFits,
  plainTheme,
  Width,
} from "./view-arbitraries.ts";

const knownLabels = new Map([
  ["observer", "🦉 Scout · Watch"],
  ["peer", "🔮 Merlin · Desk"],
]);

const labels = (name: string) => knownLabels.get(name);

const Sample = Schema.Struct({
  cc: Schema.Boolean,
  expanded: Schema.Boolean,
  kind: Schema.Literals(["message", "ask", "reply"]),
  known: Schema.Boolean,
  width: Width,
});

const mail = (
  cc: boolean,
  kind: "message" | "ask" | "reply",
  known: boolean
): Inbound => ({
  body: "The gate is clear.",
  cc,
  ccNames: ["observer"],
  copy: cc,
  did: "did:web:peer.example.invalid",
  from: "peer",
  id: "3abcdefghijk",
  kind,
  label: known ? Option.some("🔮 Merlin · Desk") : Option.none(),
  replyTo: Option.none(),
  summary: Option.some("Gate ready"),
  verified: true,
});

const plain = (lines: readonly string[]) =>
  lines.map(stripTerminalSequences).join("\n");

it.effect.prop(
  "Rat King headers replace the callable name, known parties lead calls and receipts, and status keeps its own callsign",
  [Arbitrary.schema(Schema.Boolean)],
  ([known]) =>
    Effect.sync(() => {
      const lookup = known ? labels : noLabels;

      const call = plain(
        callView(
          "intercom",
          { action: "send", cc: ["observer"], to: "peer" },
          ansiTheme,
          lookup
        ).render(240)
      );

      const text = receiptText("Delivered to", {
        did: "did:web:peer.example.invalid",
        id: "3abcdefghijk",
        recipients: [
          { level: "wake", name: "peer" },
          { level: "quiet", name: "observer" },
        ],
        seq: 1,
        to: "peer",
      });

      const result = plain(
        resultView(
          {
            action: "send",
            details: {
              id: "3abcdefghijk",
              recipients: [
                { level: "wake", name: "peer" },
                { level: "quiet", name: "observer" },
              ],
              seq: 1,
            },
            expanded: true,
            isError: false,
            isPartial: false,
            text,
          },
          ansiTheme,
          lookup
        ).render(240)
      );

      const status = statusText("intercom", {
        endpoint: "https://mail.example.invalid",
        quarantine: { count: 0, latest: Option.none() },
        reader: ReaderState.Starting({ reason: "starting" }),
        self: Option.some({
          did: "did:web:peer.example.invalid",
          name: "peer",
        }),
      });

      const statusView = plain(
        resultView(
          {
            action: "status",
            details: {},
            expanded: false,
            isError: false,
            isPartial: false,
            text: status,
          },
          ansiTheme,
          lookup
        ).render(240)
      );

      for (const view of [call, result, statusView]) {
        expect(view.includes("🐀")).toBe(view === call);
        expect(view).not.toMatch(
          /Rat King (?:send|ask|reply|status|cc|record|message)|🐀 Rat King/u
        );
        expect(view).not.toContain("intercom");
        expect(view).toContain(known ? "🔮 Merlin · Desk" : "peer");
      }

      expect(call).toContain("+1 cc");
      expect(call).not.toContain(known ? "🦉 Scout · Watch" : "observer");
      expect(result).toContain(known ? "🦉 Scout · Watch" : "observer");

      expect(call).toMatch(/^🐀 {2}send/u);
    })
);

it.effect.prop(
  "collapsed mail hides callable reply instructions and the quiet-copy note, expansion restores them, and model content keeps the exact call",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      const inbound = mail(sample.cc, sample.kind, sample.known);
      const value = inboundDetails(inbound, false);

      const lines = inboundLines({
        expanded: sample.expanded,
        labels,
        theme: plainTheme,
        tool: "intercom",
        value,
        width: sample.width,
      });

      assertFits(lines, sample.width);

      const collapsed = plain(
        inboundLines({
          expanded: false,
          labels,
          theme: ansiTheme,
          tool: "intercom",
          value,
          width: 240,
        })
      );

      const expanded = plain(
        inboundLines({
          expanded: true,
          labels,
          theme: plainTheme,
          tool: "intercom",
          value,
          width: 240,
        })
      );

      const content = renderInbound("intercom", inbound);

      const hint =
        'To reply: intercom({ action: "reply", replyTo: "3abcdefghijk", summary: "...", message: "..." })';

      expect(collapsed).not.toContain("intercom");
      expect(collapsed).not.toContain("To reply:");
      expect(collapsed).not.toContain(COPY_NOTE);
      expect(collapsed).toContain("🔮 Merlin · Desk");
      expect(collapsed).not.toContain("Desk peer");
      expect(expanded).toContain(hint);
      expect(content).toContain(hint);

      if (sample.cc) {
        expect(collapsed).toContain("🐀 cc from");
        expect(collapsed.includes("quiet")).toBe(sample.kind !== "ask");

        if (sample.kind !== "ask") {
          expect(expanded).toContain(COPY_NOTE);
          expect(content).toContain(COPY_NOTE);
        }
      }
    })
);

it.effect.prop(
  "digests, records and relay copies share callsign colours and hide callable clutter collapsed",
  [Arbitrary.schema(Schema.Boolean)],
  ([expanded]) =>
    Effect.sync(() => {
      const inbound = mail(true, "message", true);

      const mails = [
        {
          content: renderInbound("intercom", inbound),
          details: inboundDetails(inbound, false),
          id: inbound.id,
          line: digestLine(inbound),
        },
      ];

      const content = renderDigest("intercom", mails);

      const digest = plain(
        digestView({
          content,
          details: {
            ...digestDetails(mails),
            messages: mails.map((held) => held.details),
          },
          expanded,
          labels,
          theme: plainTheme,
        }).render(240)
      );

      const notice = plain(
        recordView({
          content:
            "📦 record example.notice (id 3abcdefghijk), not rendered by this reader",
          details: inboundDetails(inbound, false),
          expanded,
          labels,
          theme: plainTheme,
        }).render(240)
      );

      const relay = {
        ...inboundDetails(inbound, false),
        sentBy: "observer",
        to: "peer",
      };

      const copy = plain(
        inboundLines({
          expanded,
          labels,
          theme: plainTheme,
          tool: "intercom",
          value: relay,
          width: 240,
        })
      );

      for (const view of [digest, notice, copy]) {
        expect(view).toContain("🐀");
        expect(view).not.toMatch(
          /Rat King (?:send|ask|reply|status|cc|record|message)|🐀 Rat King/u
        );
        expect(view).toContain(
          expanded ? "🔮 Merlin · Desk (peer)" : "🔮 Merlin · Desk"
        );
      }

      expect(digest).toContain(
        expanded
          ? "🔮 Merlin · Desk (peer) · Gate ready"
          : "🔮 Merlin · Desk · Gate ready"
      );
      expect(digest.includes("intercom")).toBe(expanded);
      expect(copy).not.toContain("intercom");
      expect(notice).not.toContain("intercom");
      const colour = roleColour(roleOf("peer", labels("peer")));
      expect(party(ansiTheme, "peer", labels("peer"))).toContain(
        ansiTheme.fg(colour, ansiTheme.bold("🔮 Merlin · Desk"))
      );
    })
);

it.effect.prop(
  "delivery failures name Rat King without suggesting another transport",
  [Arbitrary.schema(Schema.Literals(["NotConfigured", "UnknownName"]))],
  ([code]) =>
    Effect.sync(() => {
      const text = notDeliveredText(
        new NotDelivered({ code, reason: "No identity" })
      );

      expect(text).toContain("No fallback; nothing reached the recipient.");
      expect(text).not.toContain("intercom");
    })
);
