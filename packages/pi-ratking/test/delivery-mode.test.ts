import { attend } from "@rat-king/ratking-client/attend";
import type { Arrival } from "@rat-king/ratking-client/attend";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { applyDelivery, verdictToHold } from "../src/pending.ts";
import type { Hold } from "../src/pending.ts";

const deliveryMode = (arrival: Arrival) =>
  applyDelivery<Hold>(
    verdictToHold(attend(arrival, {}, 0, undefined, Option.none())),
    {
      inject: (hold) => hold,
      settle: () => {
        throw new Error("Intent cannot settle");
      },
    }
  );

describe("deliveryMode", () => {
  it("steers mail addressed to this reader so a long turn sees it at the next tool batch", () => {
    expect(deliveryMode({ kind: "message" })).toBe("steer");
    expect(deliveryMode({ copy: false, kind: "message" })).toBe("steer");
  });

  it("holds a cc'd copy for the next turn without waking the reader", () => {
    expect(deliveryMode({ copy: true, kind: "message" })).toBe("nextTurn");
    expect(deliveryMode({ copy: true, kind: "data" })).toBe("nextTurn");
  });

  it("holds a cc'd copy for the digest when the reader has a cadence", () => {
    expect(
      deliveryMode({ copy: true, digestMinutes: 30, kind: "message" })
    ).toBe("digest");
    expect(
      deliveryMode({ copy: false, digestMinutes: 30, kind: "message" })
    ).toBe("steer");
    expect(deliveryMode({ copy: true, digestMinutes: 30, kind: "ask" })).toBe(
      "steer"
    );
  });

  it("still wakes a cc'd reader for an ask or relayed mail", () => {
    expect(deliveryMode({ copy: true, kind: "ask" })).toBe("steer");
    expect(
      deliveryMode({ copy: true, kind: "message", relay: { name: "front" } })
    ).toBe("steer");
  });
});
