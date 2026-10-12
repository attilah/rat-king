import { describe, expect, it } from "vitest";

import { deliveryMode } from "../src/extension.ts";

describe("deliveryMode", () => {
  it("steers mail addressed to this reader so a long turn sees it at the next tool batch", () => {
    expect(deliveryMode({ cc: false })).toBe("steer");
  });

  it("keeps a copy as a follow-up for when the turn ends", () => {
    expect(deliveryMode({ cc: true })).toBe("followUp");
  });
});
