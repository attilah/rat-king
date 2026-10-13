import { fileURLToPath } from "node:url";

import { loadThemeFromPath } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import type { InboundView } from "../src/message-view.ts";
import type { ResultInput } from "../src/tool-view.ts";

export const labels = (name: string) =>
  name === "peer" ? "🔮 Merlin · Desk" : "🦉 Scout · Watch";

export const themes = ["dark", "light"].map((name) => ({
  name,
  theme: loadThemeFromPath(
    fileURLToPath(
      new URL(
        `../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/${name}.json`,
        import.meta.url
      )
    ),
    "truecolor"
  ),
}));

export const mail: InboundView = {
  body: "The gate is clear. Hold the restart wave until the reader is checked.",
  cc: false,
  ccNames: ["observer"],
  did: "did:web:peer.example.invalid",
  from: "peer",
  id: "3abcdefghijk",
  kind: "message",
  label: labels("peer"),
  summary: "Gate ready",
  verified: true,
};

export const messages = {
  "inbound cc": { ...mail, cc: true, reason: "quiet: cc" },
  "inbound mail": mail,
  "inbound reply": { ...mail, kind: "reply", replyTo: "3replyabcdef" },
  "outbound copy": { ...mail, sentBy: "observer", to: "peer" },
  "summary body prefix": {
    ...mail,
    body: "pong\nThe gate is clear.",
    summary: "pong",
  },
} satisfies Readonly<Record<string, InboundView>>;

const details = {
  id: "3abcdefghijk",
  recipients: [{ level: "wake", name: "peer" }],
  seq: 9,
};

const base: ResultInput = {
  action: "reply",
  details,
  expanded: false,
  isError: false,
  isPartial: false,
  summary: "Gate ready",
  text: "Reply delivered to peer over Rat King (id 3abcdefghijk, seq 9).",
};

export const results = {
  ask: {
    ...base,
    action: "ask",
    details: { ...details, replyId: "3replyabcdef" },
    text: "**Reply from peer** (id 3replyabcdef):\nThe gate is clear.",
  },
  error: {
    ...base,
    details: { error: true },
    text: "NOT DELIVERED: NotConfigured. No identity.\nTag: NotConfigured\nFix: configure identity\nDebug: no reader",
  },
  "pending empty": {
    ...base,
    action: "pending",
    details: {},
    text: "No unresolved inbound or outbound asks.",
  },
  "pending outbound": {
    ...base,
    action: "pending",
    details: {},
    text: "**Inbound unanswered asks:**\n**Outbound open asks:**\n- to peer · 3abcdefghijk · Gate ready",
  },
  record: {
    ...base,
    action: "record",
    details: { id: "3abcdefghijk", seq: 9, to: "peer" },
    text: "Record delivered to peer over Rat King (id 3abcdefghijk, seq 9).",
  },
  reply: base,
  "send with cc": {
    ...base,
    action: "send",
    details: {
      ...details,
      recipients: [
        { level: "wake", name: "peer" },
        { level: "quiet", name: "observer" },
      ],
    },
    text: "Delivered over Rat King (id 3abcdefghijk, seq 9).\npeer: woken (to).\nobserver: quiet copy, no wake (cc: shows next turn or at its digest).",
  },
  status: {
    ...base,
    action: "status",
    details: {},
    text: "🐀 status: peer · reader live · mailbox https://mail.example.invalid",
  },
  "summary trimmed": {
    ...base,
    text: `${base.text}\nsummary trimmed to 279 characters; the full text leads the message.`,
  },
} satisfies Readonly<Record<string, ResultInput>>;

export const record = {
  content:
    "📦 record example.notice from peer (id 3abcdefghijk), not rendered by this reader",
  details: mail,
};

export const digest = {
  content:
    '🐀 cc digest\n- peer · Gate ready\nTo reply: ratking({ action: "reply" })',
  details: { messages: [mail] },
};
