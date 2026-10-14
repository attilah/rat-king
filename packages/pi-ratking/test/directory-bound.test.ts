import { it } from "@effect/vitest";
import type { Listed } from "@rat-king/ratking-client/directory";
import {
  listView,
  suggestNames,
} from "@rat-king/ratking-client/directory-view";
import { Arbitrary, Schema } from "effect";
import { expect } from "vitest";

const Size = Schema.Int.check(Schema.isBetween({ maximum: 2000, minimum: 0 }));

const Width = Schema.Int.check(Schema.isBetween({ maximum: 240, minimum: 1 }));

const Query = Schema.Literals([
  "",
  "PRoject/",
  "probe",
  "pi-",
  "desk",
  "absent",
  "project",
]);

const Limit = Schema.Int.check(Schema.isBetween({ maximum: 200, minimum: 1 }));

const entry = (name: string, reserved = false): Listed => ({
  aliases: [],
  did: `did:web:${name.replaceAll("/", ".")}.example.invalid`,
  name,
  reserved,
});

const session = (index: number): string => {
  const suffix = index.toString(16);

  const names = [
    `pi-${suffix.padStart(26, "0")}`,
    `pi-00000000-0000-7000-8000-${suffix.padStart(5, "0")}`,
    `pi-${suffix.padStart(16, "0")}`,
  ];

  return names[Math.floor(index / 6) % names.length] ?? names[0] ?? "";
};

const directory = (size: number, width: number): readonly Listed[] =>
  Array.from({ length: size }, (_, index) => {
    const stem = `${"a".repeat(width)}${index}`;

    const names = [
      `project/${stem}`,
      session(index),
      `project/probe-${index}`,
      `project/canary-${index}`,
      `project/desk-${index}`,
      `other/${stem}`,
    ];

    return entry(names[index % names.length] ?? stem, index % 17 === 0);
  });

const nameLines = (text: string): readonly string[] =>
  text.split("\n").filter((line) => line.startsWith("- "));

const namesIn = (text: string): readonly string[] =>
  nameLines(text).map((line) => line.slice(2).split(" · ")[0] ?? "");

it.prop(
  "default listings hide ephemeral names, retain reserved/self eligibility and never expose DIDs or exceed 50 names / 4096 bytes",
  [Arbitrary.schema(Size), Arbitrary.schema(Width)],
  ([size, width]) => {
    const entries = directory(size, width);
    const self = entries[1]?.name;
    const view = listView(entries, self, {});

    const eligible = entries.filter(
      (item, index) =>
        item.reserved || item.name === self || index % 6 === 0 || index % 6 >= 4
    );

    const expected = eligible.toSorted((a, b) => a.name.localeCompare(b.name));
    expect(Buffer.byteLength(view.text)).toBeLessThanOrEqual(4096);
    expect(nameLines(view.text).length).toBeLessThanOrEqual(50);
    expect(view.text).not.toContain("did:");
    expect(view.text.split("\n")[0]).toBe(
      `Directory: ${size} total · ${view.shown} shown · ${size - view.shown} hidden · ${eligible.length} matched`
    );
    expect(namesIn(view.text)).toEqual(
      expected.slice(0, view.shown).map((item) => item.name)
    );
  },
  { arbitrary: { runs: 80 } }
);

it.prop(
  "filters precede the cap, use case-insensitive substring or trailing-slash prefix, and reveal matching ephemeral names",
  [Arbitrary.schema(Size), Arbitrary.schema(Query)],
  ([size, query]) => {
    const entries = directory(size, 1);
    const lower = query.toLowerCase();

    const expected = entries
      .filter((item) =>
        lower.endsWith("/")
          ? item.name.startsWith(lower)
          : item.name.includes(lower)
      )
      .toSorted((a, b) => a.name.localeCompare(b.name));

    const view = listView(entries, undefined, { match: query });
    expect(namesIn(view.text)).toEqual(
      expected.slice(0, view.shown).map((item) => item.name)
    );
    expect(view.shown).toBe(Math.min(50, expected.length));
    expect(view.text.split("\n")[0]).toBe(
      `Directory: ${size} total · ${view.shown} shown · ${size - view.shown} hidden · ${expected.length} matched`
    );
    expect(view.text).not.toContain("did:");
  }
);

it.prop(
  "following actual all-page offsets joins the full sorted directory without gaps or duplicates within the byte bound",
  [Arbitrary.schema(Size), Arbitrary.schema(Width), Arbitrary.schema(Limit)],
  ([size, width, limit]) => {
    const entries = directory(size, width);
    const collected: string[] = [];
    let offset = 0;

    while (offset < size) {
      const view = listView(entries, undefined, { all: true, limit, offset });
      expect(Buffer.byteLength(view.text)).toBeLessThanOrEqual(4096);
      expect(view.shown).toBeGreaterThan(0);
      expect(view.shown).toBeLessThanOrEqual(limit);
      expect(view.nextOffset).toBe(offset + view.shown);

      if (view.nextOffset < size) {
        expect(view.text).toContain(`offset: ${view.nextOffset}`);
      }

      for (const line of nameLines(view.text)) {
        expect(line).toContain(" · did:");
      }

      collected.push(...namesIn(view.text));
      offset = view.nextOffset;
    }

    expect(collected).toEqual(
      entries.map((item) => item.name).toSorted((a, b) => a.localeCompare(b))
    );
    expect(new Set(collected).size).toBe(size);
  },
  { arbitrary: { runs: 30 } }
);

it.prop(
  "single-edit typos rank their unique closest name first, suggestions are bounded, stable names win and empty directories add nothing",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 1 }))
    ),
    Schema.Literals(["insert", "delete", "replace"]),
  ],
  ([size, operation]) => {
    const name = `project/${"z".repeat(size)}desk`;

    const query =
      operation === "insert"
        ? `${name}x`
        : `${name.slice(0, -1)}${operation === "replace" ? "x" : ""}`;

    const others = ["muster/launcher", "other/worker", "unrelated"];

    expect(suggestNames(query, [name, ...others])[0]).toBe(name);
    expect(
      suggestNames("project/", [
        name,
        ...others,
        "project/probe",
        "project/canary",
      ]).length
    ).toBeLessThanOrEqual(3);
    expect(
      suggestNames(
        "project/",
        Array.from({ length: size + 4 }, (_, index) => `project/row-${index}`)
      )
    ).toHaveLength(3);
    expect(
      suggestNames("project/probx", ["project/probe", "project/proxy"])
    ).toEqual(["project/proxy"]);
    expect(suggestNames("project/probx", ["project/probe"])).toEqual([
      "project/probe",
    ]);
    expect(suggestNames(query, [])).toEqual([]);
    expect(suggestNames("desk", ["beta/desk", "alfa/desk"])).toEqual([
      "alfa/desk",
      "beta/desk",
    ]);
  }
);

it("synthetic 706-name fixture keeps desk names visible and bounds huge multibyte metadata", () => {
  const entries = [
    ...Array.from({ length: 173 }, (_, index) => entry(session(index))),
    ...Array.from({ length: 18 }, (_, index) =>
      entry(`test/${index % 2 === 0 ? "probe" : "canary"}-${index}`)
    ),
    ...Array.from({ length: 515 }, (_, index) =>
      entry(`project-${index}/desk`)
    ),
  ];

  const view = listView(entries, undefined, {});
  expect(view.text).toContain(
    "706 total · 50 shown · 656 hidden · 515 matched"
  );
  expect(view.text).toContain("/desk");
  expect(
    listView(
      [{ ...entry("project/desk", true), aliases: ["desk"] }],
      "project/desk",
      {}
    ).text
  ).toContain("- project/desk (alias desk) · reserved · you");
  expect(Buffer.byteLength(view.text)).toBeLessThanOrEqual(4096);

  const huge = [
    { ...entry("project/desk", true), aliases: ["😀".repeat(5000)] },
    entry("project/worker"),
  ];

  const page = listView(huge, "project/desk", { all: true });
  expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(4096);
  expect(page.shown).toBeGreaterThan(0);
  expect(listView([], undefined, {}).text).toBe(
    "Directory: 0 total · 0 shown · 0 hidden · 0 matched"
  );
});
