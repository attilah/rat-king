import { it } from "@effect/vitest";
import * as DeskDefs from "@rat-king/lexicon/desk.defs";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import {
  bodyBytes,
  digestOrder,
  mentions,
  ownerCid,
  titleCodePoints,
  withinCaps,
} from "../src/owner-queue.ts";

const desk = "did:web:desk.example.invalid";

const authors = ["a", "b", "c"].map(
  (name) => `did:web:agent-${name}.example.invalid`
);

const Entry = Schema.Struct({
  author: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(2)
  ),
  kind: Schema.Literals([
    "fyi",
    "progress",
    "done",
    "question",
    "blocked",
    "action",
  ]),
  mention: Schema.Boolean,
});

const entryOf = (spec: typeof Entry.Type, index: number) => {
  const prefix = `@${desk}`;

  return {
    item: Schema.decodeUnknownSync(DeskDefs.OwnerItem)({
      author: authors[spec.author] ?? desk,
      cid: "0".repeat(32),
      createdAt: "2026-10-11T00:00:00.000Z",
      facets: spec.mention
        ? [
            {
              features: [
                { $type: "sh.mschf.ratking.desk.defs#mention", did: desk },
              ],
              index: { byteEnd: prefix.length, byteStart: 0 },
            },
          ]
        : [],
      kind: spec.kind,
      text: spec.mention ? `${prefix} note ${index}` : `note ${index}`,
      uri: `muster://note/${index}`,
    }),
  };
};

it.prop(
  "digest order: mentions first, only the latest progress per author, then the rest grouped by author",
  [Arbitrary.array(Arbitrary.schema(Entry), { maxLength: 30 })],
  ([specs]) => {
    const entries = specs.map(entryOf);
    const ordered = digestOrder(entries, desk);
    const mentioned = entries.filter((entry) => mentions(entry.item, desk));
    const quiet = ordered.slice(mentioned.length);

    expect(ordered.slice(0, mentioned.length)).toEqual(mentioned);

    const latest = new Map(
      entries
        .filter(
          (entry) =>
            entry.item.kind === "progress" && !mentions(entry.item, desk)
        )
        .map((entry) => [entry.item.author, entry])
    );

    expect(new Set(quiet)).toEqual(
      new Set(
        entries.filter(
          (entry) =>
            !mentions(entry.item, desk) &&
            (entry.item.kind !== "progress" ||
              latest.get(entry.item.author) === entry)
        )
      )
    );

    const runs = quiet
      .map((entry) => entry.item.author)
      .filter((author, index, all) => author !== all[index - 1]);

    expect(runs).toEqual([...new Set(runs)]);

    for (const author of runs) {
      const own = quiet.filter((entry) => entry.item.author === author);

      expect(own).toEqual(entries.filter((entry) => own.includes(entry)));
    }
  }
);

const utf8 = (text: string) => new TextEncoder().encode(text).length;

const capBody = (body: string) => {
  let bytes = 0;
  let result = "";

  for (const char of body) {
    bytes += utf8(char);

    if (bytes > bodyBytes) {
      break;
    }

    result += char;
  }

  return result;
};

it.prop(
  "text built under the title and body caps passes, and one code point over the body cap fails",
  [
    Arbitrary.schema(Schema.String),
    Arbitrary.schema(Schema.String),
    Arbitrary.schema(Schema.Boolean),
  ],
  ([title, body, mention]) => {
    // oxlint-disable-next-line typescript/no-misused-spread -- Muster caps titles by code point, not by grapheme.
    const flat = [...title.replaceAll(/\r?\n/gu, " ")]
      .slice(0, titleCodePoints)
      .join("");

    const prefix = mention ? `@${desk} ` : "";
    const filler = "é".repeat(bodyBytes);

    expect(withinCaps(`${prefix}${flat}\n${capBody(body)}`)).toBe(
      !/\p{Cs}/u.test(flat) && !/\p{Cs}/u.test(body)
    );
    expect(withinCaps(`${prefix}${capBody(filler)}`)).toBe(true);
    expect(withinCaps(`${prefix}${capBody(filler)}é`)).toBe(false);
  }
);

it.effect.prop(
  "the same content gives the same cid, whatever its key order",
  [
    Arbitrary.schema(
      Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Int]))
    ),
  ],
  ([content]) =>
    Effect.gen(function* cidIsCanonical() {
      const reversed = Object.fromEntries(Object.entries(content).toReversed());

      expect(yield* ownerCid(reversed)).toBe(yield* ownerCid(content));
    })
);
