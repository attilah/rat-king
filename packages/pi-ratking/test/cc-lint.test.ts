import { it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import { ccLint, ccRefusalPrompt } from "../src/cc-lint.ts";
import { toolCall, ToolParams } from "../src/tool.ts";

const Segment = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{1,7}$/u));

const Filler = Schema.String.check(
  Schema.isPattern(/^[a-z]{1,8}(?: [a-z]{1,8}){0,3}$/u)
);

const Names = Schema.Struct({
  ccProject: Segment,
  ccRow: Segment,
  extra: Segment,
  toProject: Segment,
  toRow: Segment,
});

const Phrasing = Schema.Struct({
  after: Filler,
  before: Filler,
  form: Schema.Literals(["full", "row"]),
  how: Schema.Literals(["@", "asked of you:", "ask for", "question for"]),
  shout: Schema.Boolean,
  where: Schema.Literals(["message", "summary"]),
});

const named = (sample: typeof Names.Type) => ({
  cc: `${sample.ccProject}/${sample.ccRow}-cc`,
  extra: `${sample.extra}-extra`,
  to: `${sample.toProject}/${sample.toRow}-to`,
});

const formOf = (name: string, form: "full" | "row") =>
  form === "full" ? name : name.slice(name.lastIndexOf("/") + 1);

const addressing = (phrasing: typeof Phrasing.Type, target: string) => {
  const line =
    phrasing.how === "@"
      ? `${phrasing.before} @${target} ${phrasing.after}`
      : `${phrasing.before}\n${phrasing.how} ${target}: ${phrasing.after}`;

  return phrasing.shout ? line.toUpperCase() : line;
};

const lintOf = (
  names: ReturnType<typeof named>,
  text: { readonly message: string; readonly summary: string },
  ccOnPurpose = false
) =>
  ccLint({
    body: Option.some(text.message),
    ccOnPurpose,
    kind: "message",
    names: [names.to, names.extra, names.cc],
    summary: text.summary,
  });

const placed = (phrasing: typeof Phrasing.Type, text: string) =>
  phrasing.where === "message"
    ? { message: text, summary: phrasing.before }
    : { message: phrasing.after, summary: text };

it.prop(
  "an @name, @row or ask line aimed at a cc refuses the send, in any case and in message or summary; ccOnPurpose lets it through",
  [Names, Phrasing],
  ([sample, phrasing]) => {
    const names = named(sample);

    const text = placed(
      phrasing,
      addressing(phrasing, formOf(names.cc, phrasing.form))
    );

    expect(Option.map(lintOf(names, text), (hit) => hit.name)).toEqual(
      Option.some(names.cc)
    );
    expect(lintOf(names, text, true)).toEqual(Option.none());
  }
);

it.prop(
  "a bare mention, a longer name that only starts with the cc, and an address to the to name all pass",
  [Names, Phrasing],
  ([sample, phrasing]) => {
    const names = named(sample);
    const target = formOf(names.cc, phrasing.form);

    for (const text of [
      `${phrasing.before} cc ${target} ${phrasing.after}`,
      `${phrasing.before} @${target}x ${phrasing.after}`,
      addressing(phrasing, formOf(names.to, phrasing.form)),
    ]) {
      expect(lintOf(names, placed(phrasing, text))).toEqual(Option.none());
    }
  }
);

it.prop(
  "a cc that shares the to name's row part is not refused for addressing that row",
  [Names, Phrasing],
  ([sample, phrasing]) => {
    const to = `${sample.toProject}/${sample.toRow}`;
    const cc = `${sample.ccProject}-cc/${sample.toRow}`;

    expect(
      ccLint({
        body: Option.some(
          addressing({ ...phrasing, shout: false }, sample.toRow)
        ),
        ccOnPurpose: false,
        kind: "message",
        names: [to, cc],
        summary: undefined,
      })
    ).toEqual(Option.none());
  }
);

const callIn = (line: string, tool: string) => {
  const start = line.indexOf(`${tool}(`) + tool.length + 1;
  const end = line.indexOf(")", start);

  const parsed: unknown = JSON.parse(line.slice(start, end));

  return parsed;
};

it.effect.prop(
  "the refusal is a prompt: tag and snippet, accepted forms, a Fix call that decodes as tool params with the cc moved into to, and a Debug call",
  [Names, Phrasing, Schema.Literals(["send", "ask", "reply"])],
  ([sample, phrasing, action]) =>
    Effect.gen(function* refusal() {
      const names = named(sample);

      const text = addressing(
        { ...phrasing, how: "@", shout: false },
        names.cc
      );

      const addressed = Option.getOrThrow(
        lintOf(names, { message: text, summary: "" })
      );

      const prompt = ccRefusalPrompt({
        action,
        addressed,
        call: (call) => toolCall("intercom", call),
      });

      const [tag, accepted, fix, debug] = prompt.split("\n");

      expect(tag).toBe(
        `AskAimedAtCc: you sent to ${names.to} with ${names.cc} in cc, and the text addresses ${names.cc} (${addressed.snippet}), so ${names.cc} would get a quiet copy and not wake.`
      );
      expect(text).toContain(addressed.snippet);
      expect(addressed.snippet.length).toBeLessThanOrEqual(60);
      expect(accepted).toBe(
        `Accepted: ${names.cc} in to, or ccOnPurpose: true.`
      );

      const params = yield* Schema.decodeUnknownEffect(ToolParams)(
        callIn(fix ?? "", "intercom"),
        { onExcessProperty: "error" }
      );

      expect(params).toEqual({
        action: action === "ask" ? "ask" : "send",
        cc: [names.to, names.extra],
        message: "...",
        summary: "...",
        to: names.cc,
      });

      expect(
        yield* Schema.decodeUnknownEffect(ToolParams)(
          callIn(debug ?? "", "intercom"),
          { onExcessProperty: "error" }
        )
      ).toEqual({ action: "list" });
    })
);
