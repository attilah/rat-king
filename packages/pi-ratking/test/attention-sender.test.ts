import { it } from "@effect/vitest";
import { attend } from "@rat-king/ratking-client/attend";
import { Option, Schema } from "effect";
import { expect } from "vitest";

import {
  defaultPreferences,
  defaultStatus,
} from "../../mailbox-client/src/attention.ts";

it.prop(
  "Hard levers use the authenticated sender, never an unverified payload label",
  [Schema.Literals(["alarm", "joel", "operator"])],
  ([claimed]) => {
    const levers = {
      enabled: true,
      prefs: { ...defaultPreferences(), allow: [claimed] },
      status: { ...defaultStatus(), state: "dnd" as const },
    };

    const arrival = {
      from: claimed,
      kind: "message" as const,
      sender: "noisy",
      verified: false,
    };

    expect(attend(arrival, levers, 0, undefined, Option.none())._tag).toBe(
      "Later"
    );
    expect(
      attend(
        arrival,
        { ...levers, prefs: { ...levers.prefs, refuse: ["noisy"] } },
        0,
        undefined,
        Option.none()
      )._tag
    ).toBe("Never");
    expect(
      attend(
        { ...arrival, sender: "joel" },
        levers,
        0,
        undefined,
        Option.none()
      )._tag
    ).toBe("Now");
  }
);
