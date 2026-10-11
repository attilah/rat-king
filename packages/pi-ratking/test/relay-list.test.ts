import { Schema } from "effect";
import { expect, it } from "vitest";

import { PiConfig, relaysOf } from "../src/config.ts";
import { copiesOutbound } from "../src/relay.ts";

const front = {
  copyOutbound: true,
  fallbackMinutes: 10,
  mode: "front",
  name: "acme",
  to: "acme/ea",
} as const;

const second = {
  fallbackMinutes: 10,
  mode: "front",
  name: "widgets/desk",
  to: "widgets/ea",
} as const;

const base = {
  didTemplate: "did:web:{agent}.agents.example.invalid",
  endpoint: "http://mailbox.example.invalid:8787",
  serviceDid: "did:web:mailbox.example.invalid",
};

it("relay accepts one entry or a list, and the old single object still decodes", () => {
  const single = Schema.decodeUnknownSync(PiConfig)({ ...base, relay: front });

  const list = Schema.decodeUnknownSync(PiConfig)({
    ...base,
    relay: [front, second],
  });

  expect(relaysOf(single.relay)).toEqual([front]);
  expect(relaysOf(list.relay)).toEqual([front, second]);
  expect(relaysOf(Schema.decodeUnknownSync(PiConfig)(base).relay)).toEqual([]);
});

it("each relay entry applies only to its own front name", () => {
  const relays = relaysOf([front, second]);

  const forFront = relays.find((relay) => relay.name === "acme");
  const forSecond = relays.find((relay) => relay.name === "widgets/desk");

  expect(copiesOutbound(forFront, "acme", ["peer"])).toBe(true);
  expect(copiesOutbound(forSecond, "widgets/desk", ["peer"])).toBe(false);
  expect(
    relays.find(
      (relay) => relay.name === "widgets/ea" || relay.to === "widgets/ea"
    )?.name
  ).toBe("widgets/desk");
});
