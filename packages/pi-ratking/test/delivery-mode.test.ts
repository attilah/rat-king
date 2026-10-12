import { describe, expect, it } from "vitest";

import { deliveryMode } from "../src/extension.ts";

describe("deliveryMode", () => {
  it("steers mail addressed to this reader so a long turn sees it at the next tool batch", () => {
    expect(deliveryMode({ kind: "message" })).toBe("steer");
    expect(deliveryMode({ copy: false, kind: "message" })).toBe("steer");
  });

  it("holds a cc'd copy for the next turn without waking the reader", () => {
    expect(deliveryMode({ copy: true, kind: "message" })).toBe("nextTurn");
    expect(deliveryMode({ copy: true, kind: "data" })).toBe("nextTurn");
  });

  it("still wakes a cc'd reader for an ask or relayed mail", () => {
    expect(deliveryMode({ copy: true, kind: "ask" })).toBe("steer");
    expect(
      deliveryMode({ copy: true, kind: "message", relay: { name: "front" } })
    ).toBe("steer");
  });
});
