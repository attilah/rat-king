import { it } from "@effect/vitest";
import * as Prefs from "@rat-king/lexicon/attention.prefs";
import { attend, ruleVerdict } from "@rat-king/ratking-client/attend";
import type { Arrival } from "@rat-king/ratking-client/attend";
import { Arbitrary, DateTime, Option, Schema } from "effect";
import { expect } from "vitest";

import { defaultPreferences } from "../../mailbox-client/src/attention.ts";

const Sender = Schema.Literals([
  "fleet/desk",
  "fleet/worker",
  "other/worker",
  "worker",
  "joel",
  "operator",
]);

const Type = Schema.Literals([
  "message",
  "sh.mschf.agentgraph.turn",
  "sh.mschf.agentgraph.checkin",
]);

const Route = Schema.Literals(["wake", "quiet", "digest", "hide"]);

const RuleSample = Schema.Struct({
  expired: Schema.Boolean,
  from: Schema.optionalKey(
    Schema.Literals([
      "fleet/*",
      "fleet/desk",
      "other/*",
      "worker",
      "joel",
      "operator",
    ])
  ),
  minutes: Schema.Int.check(Schema.isBetween({ maximum: 1440, minimum: 1 })),
  project: Schema.optionalKey(Schema.Literals(["fleet", "other", "worker"])),
  route: Route,
  type: Schema.optionalKey(Type),
});

const Input = Schema.Struct({
  copy: Schema.Boolean,
  from: Sender,
  kind: Schema.Literals(["message", "ask", "reply", "data"]),
  now: Schema.Int.check(
    Schema.isBetween({ maximum: 2_000_000, minimum: 1_000_000 })
  ),
  rules: Schema.Array(RuleSample).check(Schema.isMaxLength(32)),
  type: Type,
  verified: Schema.Boolean,
});

type InputValue = typeof Input.Type;

const rulesOf = (input: InputValue): readonly Prefs.RuleValue[] =>
  input.rules.map((sample, index) => {
    const { expired, from, minutes, project, route, type } = sample;
    const match = {};

    if (from !== undefined) {
      Object.assign(match, { from });
    }

    if (project !== undefined) {
      Object.assign(match, { project });
    }

    if (type !== undefined) {
      Object.assign(match, { type });
    }

    const rule = {
      id: `rule-${index}`,
      match,
      route,
      until: DateTime.formatIso(
        DateTime.makeUnsafe(input.now + (expired ? -1 : 1))
      ),
    };

    return Schema.decodeUnknownSync(Prefs.Rule)(
      route === "digest" ? { ...rule, minutes } : rule
    );
  });

const matchingIndex = (input: InputValue): number => {
  if (
    (input.verified && ["joel", "operator"].includes(input.from)) ||
    (input.kind === "ask" && !input.copy)
  ) {
    return -1;
  }

  if (!input.verified) {
    return input.rules.findIndex(
      (rule) =>
        !rule.expired &&
        rule.from === undefined &&
        rule.project === undefined &&
        (rule.type === undefined || rule.type === input.type)
    );
  }

  return input.rules.findIndex((rule) => {
    const { from } = rule;
    const prefix = from?.split("*")[0] ?? "";

    const senderMatches =
      from === undefined ||
      (from.includes("*")
        ? input.from.startsWith(prefix)
        : from === input.from);

    const projectMatches =
      rule.project === undefined ||
      (input.from.includes("/") &&
        input.from.split("/").at(0) === rule.project);

    return (
      !rule.expired &&
      senderMatches &&
      projectMatches &&
      (rule.type === undefined || rule.type === input.type)
    );
  });
};

it.prop(
  "rules match a first-match oracle across arrivals, selectors, expiry, guards and digest windows",
  [Arbitrary.schema(Input)],
  ([input]) => {
    const arrival: Arrival = {
      copy: input.copy,
      from: input.from,
      kind: input.kind,
      type: input.type,
      verified: input.verified,
    };

    const rules = rulesOf(input);
    const index = matchingIndex(input);
    const verdict = ruleVerdict(arrival, rules, input.now);
    const selected = input.rules[index];

    if (selected === undefined) {
      expect(verdict).toBeUndefined();
      const prefs = defaultPreferences();
      const levers = { enabled: true, prefs };

      expect(
        attend(
          arrival,
          { ...levers, prefs: { ...prefs, rules } },
          input.now,
          undefined,
          Option.none()
        )
      ).toEqual(attend(arrival, levers, input.now, undefined, Option.none()));

      return;
    }

    expect(verdict?.reason).toMatchObject({
      rule: `rule-${index}`,
    });
    expect(verdict?._tag).toBe(
      { digest: "Later", hide: "Never", quiet: "Next", wake: "Now" }[
        selected.route
      ]
    );

    if (verdict?._tag === "Later") {
      expect(verdict.window).toBe(selected.minutes * 60_000);
    }
  },
  { arbitrary: { runs: 3000 } }
);

it.prop(
  "matching rules cannot demote operators, direct asks or the resolved owner; order and expiry remain decisive",
  [Route, Schema.Int.check(Schema.isBetween({ maximum: 1440, minimum: 1 }))],
  ([route, minutes]) => {
    const rule: Prefs.RuleValue = {
      id: "first",
      match: {},
      minutes,
      route: "digest",
    };

    const first = route === "digest" ? rule : { id: "first", match: {}, route };
    const second: Prefs.RuleValue = { id: "second", match: {}, route: "hide" };
    const rules = [first, second];
    const prefs = { ...defaultPreferences(), rules };

    const arrival: Arrival = {
      from: "fleet/worker",
      kind: "message",
      verified: true,
    };

    expect(ruleVerdict(arrival, rules, 0)?.reason).toMatchObject({
      rule: "first",
    });
    expect(
      ruleVerdict(
        arrival,
        [
          Schema.decodeUnknownSync(Prefs.Rule)({
            ...first,
            until: "1970-01-01T00:00:00.000Z",
          }),
          second,
        ],
        0
      )?.reason
    ).toMatchObject({ rule: "second" });

    for (const from of ["joel", "operator"]) {
      expect(ruleVerdict({ ...arrival, from }, rules, 0)).toBeUndefined();
      expect(
        attend(
          { ...arrival, from },
          { enabled: true, prefs },
          0,
          undefined,
          Option.none()
        )._tag
      ).toBe("Now");
    }

    expect(ruleVerdict({ ...arrival, kind: "ask" }, rules, 0)).toBeUndefined();
    expect(
      attend(
        arrival,
        { enabled: true, owner: "fleet/worker", prefs },
        0,
        undefined,
        Option.none()
      )._tag
    ).toBe("Now");
    expect(
      attend(arrival, { enabled: false, prefs }, 0, undefined, Option.none())
        ._tag
    ).toBe("Now");
  }
);

it.prop(
  "prefs remain backward compatible and validate digest-only minutes, ISO expiry and the rule limit",
  [Schema.Int.check(Schema.isBetween({ maximum: 1440, minimum: 1 }))],
  ([minutes]) => {
    const prefs = defaultPreferences();

    const rule = {
      id: "digest",
      match: { from: "fleet/*" },
      minutes,
      route: "digest",
      until: "2030-01-01T00:00:00Z",
    };

    const valid = (rules: Schema.Json) =>
      Option.isSome(
        Schema.decodeUnknownOption(Prefs.Main)({ ...prefs, rules })
      );

    expect(Schema.decodeUnknownSync(Prefs.Main)(prefs)).toEqual(prefs);
    expect(valid([rule])).toBe(true);
    expect(valid(Array.from({ length: 32 }, () => rule))).toBe(true);
    expect(valid(Array.from({ length: 33 }, () => rule))).toBe(false);
    expect(valid([{ ...rule, minutes: 0 }])).toBe(false);
    expect(valid([{ ...rule, minutes: 1441 }])).toBe(false);
    expect(valid([{ ...rule, route: "quiet" }])).toBe(false);
    expect(valid([{ id: rule.id, match: rule.match, route: "digest" }])).toBe(
      false
    );
    expect(valid([{ ...rule, until: "tomorrow" }])).toBe(false);
    expect(valid([{ ...rule, match: { from: "fleet/*/worker" } }])).toBe(false);
  }
);
