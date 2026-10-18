import { it } from "@effect/vitest";
import { attend, forwardNames } from "@rat-king/ratking-client/attend";
import { Arbitrary, Option, Schema } from "effect";
import { expect } from "vitest";

import { defaultPreferences } from "../../mailbox-client/src/attention.ts";

it.prop(
  "a delegated original always stays in the digest even when levers are disabled or the sender normally wakes",
  [
    Arbitrary.schema(Schema.Boolean),
    Arbitrary.schema(Schema.Literals(["joel", "operator", "alpha/sender"])),
  ],
  ([enabled, sender]) => {
    const verdict = attend(
      { delegatedTo: "alpha/ea", kind: "message", sender },
      { enabled },
      0,
      undefined,
      Option.none()
    );

    expect(verdict._tag).toBe("Later");
    expect(verdict.reason._tag).toBe("delegated");
    expect(
      forwardNames(
        { delegatedTo: "alpha/ea", kind: "message", sender },
        {
          enabled,
          prefs: { ...defaultPreferences(), forward: ["alpha/forward"] },
        }
      )
    ).toEqual([]);
  }
);
