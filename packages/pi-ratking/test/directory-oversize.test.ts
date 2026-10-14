import { it } from "@effect/vitest";
import { listView } from "@rat-king/ratking-client/directory-view";
import { Arbitrary, Schema } from "effect";
import { expect } from "vitest";

const Size = Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 }));

const Width = Schema.Int.check(
  Schema.isBetween({ maximum: 6000, minimum: 3500 })
);

it.prop(
  "oversized individual names are visibly shortened, counted as shown and paged exactly once without refusing or stalling",
  [Arbitrary.schema(Size), Arbitrary.schema(Width), Schema.Boolean],
  ([size, width, all]) => {
    const entries = Array.from({ length: size }, (_, index) => ({
      aliases: [],
      did: "did:web:example.invalid",
      name: `project-${index}-${"a".repeat(width)}/desk`,
      reserved: false,
    })).toSorted((a, b) => a.name.localeCompare(b.name));

    const collected: string[] = [];

    let offset = 0;

    while (offset < size) {
      const view = listView(entries, undefined, { all, offset });

      const lines = view.text
        .split("\n")
        .filter((line) => line.startsWith("- "));

      expect(Buffer.byteLength(view.text)).toBeLessThanOrEqual(4096);
      expect(view.shown).toBe(1);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(`- ${entries[offset]?.name.slice(0, 3495)}…`);
      expect(view.nextOffset).toBe(offset + 1);
      expect(view.text).toContain(
        `${size} total · 1 shown · ${size - 1} hidden`
      );
      collected.push(...lines);
      offset = view.nextOffset;
    }

    expect(collected).toHaveLength(size);
    expect(new Set(collected).size).toBe(size);
  },
  { arbitrary: { runs: 20 } }
);
