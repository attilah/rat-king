import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { Kind, renderInbound } from "@rat-king/ratking-client/payload";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import {
  digestDetails,
  inboundDetails,
  renderDigest,
} from "../src/extension.ts";
import { inboundLines, messageView } from "../src/message-view.ts";
import type { InboundView } from "../src/message-view.ts";
import { digestView } from "../src/notice-view.ts";
import { oneLine } from "../src/tui.ts";
import {
  ansiTheme,
  assertFits,
  joined,
  plainTheme,
  Tokens,
} from "./view-arbitraries.ts";

const Sample = Schema.Struct({
  body: Tokens,
  cc: Schema.Boolean,
  expanded: Schema.Boolean,
  from: Schema.Literals(["writer", "joel", "operator"]),
  kind: Kind,
  label: Schema.Literals(["operator", "joel", "🪞 Mirror · Worker"]),
  sender: Schema.Literals(["joel", "operator", "writer"]),
  summary: Tokens,
  verified: Schema.Boolean,
});

const turn = (state: "done" | "blocked" | "crashed", reason: string) => ({
  $type: "sh.mschf.agentgraph.turn",
  agent: "writer",
  at: "2026-10-14T00:00:00.000Z",
  session: "session",
  state,
  turnId: "session:2",
  version: "0.1",
  ...(state === "done" ? { stopReason: "stop" } : { reason }),
});

const plain = (lines: readonly string[]) =>
  lines.map(stripTerminalSequences).join("\n");

const assertColumns = (
  lines: readonly string[],
  width: number,
  glyph = "🐀"
) => {
  assertFits(lines, width);
  const text = plain(lines);

  expect(text.startsWith(glyph)).toBe(true);
  expect(text).not.toMatch(/[╭╮╰╯│]/u);
};

it.effect.prop(
  "inbound, digest and turn renderers keep model bytes, gutter, frame-free output and widths 40, 60, 100; only authenticated operator names get Joel's header",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      const inbound = {
        body: joined(sample.body),
        cc: sample.cc,
        did: `did:web:${sample.from}.example.invalid`,
        from: sample.from,
        id: "3abcdefghijk",
        kind: sample.kind,
        label: Option.some(sample.label),
        replyTo: Option.none<string>(),
        sender: sample.sender,
        summary: Option.some(joined(sample.summary)),
        verified: sample.verified,
      };

      const content = renderInbound("ratking", inbound);
      const details = inboundDetails(inbound, false);
      const before = JSON.stringify(details);

      const operator = sample.verified && sample.from !== "writer";

      const agent =
        sample.label === "🪞 Mirror · Worker" ? "🪞 Mirror" : sample.from;

      const callsign = operator ? "Joel" : agent;

      for (const width of [40, 60, 100]) {
        const input = {
          content,
          details: { ...details, sender: sample.sender },
          expanded: sample.expanded,
          theme: ansiTheme,
          tool: "ratking",
        };

        const rendered = messageView(input)?.render(width) ?? [];
        assertColumns(rendered, width);
        expect(plain(rendered).split("\n")[0]?.includes("from Joel")).toBe(
          operator
        );
        expect(Buffer.from(input.content)).toEqual(Buffer.from(content));
        expect(JSON.stringify(details)).toBe(before);
        expect(renderInbound("ratking", inbound)).toBe(content);

        const mails = Array.from({ length: 4 }, (_, index) => ({
          content,
          details: { ...details, id: `3abcdefghij${index}` },
          id: `3abcdefghij${index}`,
        }));

        for (const variant of ["cc", "wake"] as const) {
          const digestContent = renderDigest("ratking", mails, variant);

          const digestInput = {
            content: digestContent,
            details: {
              ...digestDetails(mails, variant),
              messages: mails.map((mail) => mail.details),
            },
            expanded: sample.expanded,
            theme: ansiTheme,
          };

          const serialized = JSON.stringify(digestInput.details);
          const digest = digestView(digestInput).render(width);
          assertColumns(digest, width);
          expect(Buffer.from(digestInput.content)).toEqual(
            Buffer.from(digestContent)
          );
          expect(JSON.stringify(digestInput.details)).toBe(serialized);
          expect(renderDigest("ratking", mails, variant)).toBe(digestContent);
          expect(plain(digest)).toContain("4 messages");
          expect(
            plain(digest)
              .split("\n")
              .filter((line) => line.startsWith(`    ${callsign} ·`))
          ).toHaveLength(4);
        }

        for (const [state, glyph] of [
          ["done", "✓"],
          ["blocked", "!"],
          ["crashed", "✗"],
        ] as const) {
          const record = {
            ...inbound,
            body: JSON.stringify(
              turn(state, oneLine(joined(sample.body)).slice(0, 280))
            ),
            from: "writer",
            kind: "data" as const,
            verified: true,
          };

          const recordContent = renderInbound("ratking", record);

          const recordInput = {
            content: recordContent,
            details: inboundDetails(record, false),
            expanded: sample.expanded,
            theme: ansiTheme,
            tool: "ratking",
          };

          const renderedTurn = messageView(recordInput)?.render(width) ?? [];
          assertColumns(renderedTurn, width, glyph);
          expect(plain(renderedTurn)).toContain(`writer · ${state}`);
          expect(plain(renderedTurn)).toContain("turn session:2");
          expect(Buffer.from(recordInput.content)).toEqual(
            Buffer.from(recordContent)
          );
          expect(renderInbound("ratking", record)).toBe(recordContent);
        }
      }
    })
);

const Action = Schema.Struct({
  expanded: Schema.Boolean,
  verified: Schema.Boolean,
});

it.effect.prop(
  "forged operator labels and payload sender names never promote worker action mail",
  [Arbitrary.schema(Action)],
  ([sample]) =>
    Effect.sync(() => {
      const value = {
        body: "kind=action: please review the packet",
        cc: false,
        did: "did:web:writer.example.invalid",
        from: "writer",
        id: "3abcdefghijk",
        kind: "message" as const,
        label: "operator",
        sender: "joel",
        summary: "Review the packet",
        verified: sample.verified,
      };

      for (const width of [40, 60, 100]) {
        const rendered = inboundLines({
          expanded: sample.expanded,
          theme: plainTheme,
          tool: "ratking",
          value,
          width,
        });

        expect(plain(rendered)).toContain("from writer");
        expect(plain(rendered).split("\n")[0]).not.toContain("Joel");

        const forgedName = { ...value, from: "operator", verified: false };

        const forged = inboundLines({
          expanded: sample.expanded,
          theme: plainTheme,
          tool: "ratking",
          value: forgedName,
          width,
        });

        expect(plain(forged).split("\n")[0]).not.toContain("Joel");
      }
    })
);

it.effect.prop(
  "held digest rows preserve delivery order rather than regrouping replies",
  [Arbitrary.schema(Schema.Boolean)],
  ([replyFirst]) =>
    Effect.sync(() => {
      const root = { from: "root", id: "root-id", summary: "ROOT" };

      const child = {
        from: "child",
        id: "child-id",
        replyTo: "root-id",
        summary: "CHILD",
      };

      const messages = replyFirst ? [child, root] : [root, child];

      const rendered = digestView({
        content: "",
        details: { messages },
        expanded: false,
        theme: plainTheme,
      }).render(60);

      const rows = plain(rendered)
        .split("\n")
        .filter((line) => line.includes("· ROOT") || line.includes("· CHILD"));

      expect(rows).toEqual(
        messages.map((message) => `    ${message.from} · ${message.summary}`)
      );
    })
);

const captures = (): string => {
  const base: InboundView = {
    body: "The packet passed its checks. Review before landing.",
    cc: false,
    did: "did:web:writer.example.invalid",
    from: "writer",
    id: "3abcdefghijk",
    kind: "message",
    label: "🪞 Mirror · Worker",
    summary: "Packet ready",
    verified: true,
  };

  const cases = {
    blocked: {
      ...base,
      body: JSON.stringify(turn("blocked", "Waiting for review")),
      kind: "data" as const,
    },
    cc: { ...base, cc: true },
    crashed: {
      ...base,
      body: JSON.stringify(turn("crashed", "Worker exited")),
      kind: "data" as const,
    },
    done: {
      ...base,
      body: JSON.stringify(turn("done", "")),
      kind: "data" as const,
    },
    encrypted: {
      ...base,
      relay: {
        did: "did:web:relay.example.invalid",
        encrypted: true,
        name: "relay",
      },
    },
    "forged operator": { ...base, label: "operator" },
    reply: { ...base, kind: "reply" as const, replyTo: "3abcdefghij0" },
    to: base,
  };

  const texts = Object.entries(cases).map(
    ([name, value]) =>
      `${name}\n${plain(inboundLines({ expanded: false, theme: plainTheme, tool: "ratking", value, width: 60 }))}`
  );

  const messages = Array.from({ length: 4 }, (_, index) => ({
    ...base,
    from: `writer-${index}`,
    id: `3abcdefghij${index}`,
    label: `Writer ${index} · Worker`,
  }));

  const digest = digestView({
    content: "",
    details: { messages, variant: "wake" },
    expanded: false,
    theme: plainTheme,
  }).render(60);

  return [...texts, `digest\n${plain(digest)}`].join("\n\n");
};

it("captures the approved grammar at width 60", () => {
  const text = captures();

  expect(text).not.toMatch(/[╭╮╰╯│]/u);
  expect(text).toMatchSnapshot();
});
