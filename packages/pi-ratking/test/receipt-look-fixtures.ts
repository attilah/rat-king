import { Box } from "@earendil-works/pi-tui";

import { callView, resultView } from "../src/tool-view.ts";
import type { CallArgs, ResultInput } from "../src/tool-view.ts";
import { themes } from "./inline-fixtures.ts";

const [dark] = themes;

if (dark === undefined) {
  throw new Error("Missing dark fixture theme");
}

export const receiptTheme = dark.theme;

const names = new Map([
  ["archive/desk", "📁 Archive · Desk"],
  ["observer/desk", "💬 Observer · Desk"],
]);

export const receiptLabels = (name: string) => names.get(name);

const base: ResultInput = {
  action: "send",
  details: {
    durationMs: 96,
    id: "3fixturemsg01",
    recipients: [{ level: "wake", name: "peer/desk" }],
    seq: 3300,
  },
  expanded: false,
  isError: false,
  isPartial: false,
  text: "Delivered to peer/desk over Rat King (id 3fixturemsg01, seq 3300).",
};

interface ReceiptFixture {
  readonly call: CallArgs;
  readonly result: ResultInput;
}

export const receiptFixtures = {
  ask: {
    call: { action: "ask", summary: "Is the gate clear?", to: "peer/desk" },
    result: { ...base, action: "ask" },
  },
  "not delivered": {
    call: { action: "send", summary: "Gate ready", to: "peer/desk" },
    result: {
      ...base,
      details: { error: true },
      isError: true,
      text: "NOT DELIVERED: no identity.\nTag: NotConfigured\nFix: configure identity",
    },
  },
  "reply all with cc": {
    call: {
      action: "reply",
      cc: ["observer/desk"],
      replyTo: "3fixtureprev1",
      summary:
        "Run the approved archive batch. Hold the other rows. Start with the canary and report its result before continuing.",
    },
    result: {
      ...base,
      action: "reply",
      details: {
        durationMs: 96,
        id: "3fixturemsg01",
        recipients: [
          { level: "wake", name: "peer/desk" },
          { level: "quiet", name: "observer/desk" },
        ],
        seq: 3300,
      },
    },
  },
  send: {
    call: { action: "send", summary: "Gate ready", to: "peer/desk" },
    result: base,
  },
  "sender only": {
    call: {
      action: "reply",
      replyAll: false,
      replyTo: "3fixtureprev2",
      summary:
        "Handled: the approved batch is queued. Canary first, result before the full run.",
    },
    result: {
      ...base,
      action: "reply",
      details: {
        durationMs: 63,
        id: "3fixturemsg02",
        seq: 11_334,
        to: "archive/desk",
      },
      text: "Reply delivered to archive/desk over Rat King (id 3fixturemsg02, seq 11334).",
    },
  },
} satisfies Readonly<Record<string, ReceiptFixture>>;

export const receiptBox = (fixture: ReceiptFixture, expanded: boolean) => {
  const state = {};

  const call = callView("ratking", fixture.call, receiptTheme, receiptLabels, {
    state,
  });

  const result = resultView(
    { ...fixture.result, expanded },
    receiptTheme,
    receiptLabels,
    { state }
  );

  const box = new Box(1, 1, (text) => receiptTheme.bg("toolSuccessBg", text));
  box.addChild(call);
  box.addChild(result);

  return box;
};
