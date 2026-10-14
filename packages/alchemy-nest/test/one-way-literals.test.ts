import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

import {
  classifyOneWay,
  oneWayAnswer,
  parseUnifiedDiff,
} from "../../../stacks/nest/one-way.ts";
import type { FileDiff } from "../../../stacks/nest/one-way.ts";

const file = (added: readonly string[]): FileDiff => ({
  added,
  after: null,
  before: null,
  newPath: "packages/envelope/src/key.ts",
  oldPath: "packages/envelope/src/key.ts",
  path: "packages/envelope/src/key.ts",
  removed: [],
});

const FakeCall = Schema.Literals([
  "retire(name)",
  "storage.delete(id)",
  "writeFile(path, key)",
  "verificationMethod: next",
]);

it.prop(
  "regex literals and template text never become operation call sites",
  [FakeCall],
  ([text]) => {
    const patterns = [
      `const pattern = /${text}/g;`,
      `const make = () => /${text}/g;`,
      `const pattern = /* operand */ /${text}/g;`,
      `const pattern = // operand\n /${text}/g;`,
      `return /${text}/u;`,
      `match(/${text}/);`,
      `const patterns = [/${text}/];`,
      `const pattern = enabled ? /${text}/g : /${text}/u;`,
      `const pattern = /${text}["'\u0060]/g;`,
      `const pattern = /${text}[\\/]/g;`,
      "const pattern = /escaped\\/slash/;",
      `const description = \`${text}\`;`,
      `const description = \`\n${text}\n\`;`,
    ];

    for (const pattern of patterns) {
      expect(classifyOneWay([file(pattern.split("\n"))]).findings).toEqual([]);
    }
  }
);

const Numerator = Schema.Int.check(
  Schema.isBetween({ maximum: 1000, minimum: 1 })
);

it.prop(
  "division expressions still expose genuine retirement, deletion and key-write calls",
  [Numerator],
  ([numerator]) => {
    const operations = [
      { call: "retire(name)", kind: "name-retirement" },
      { call: "storage.delete(id)", kind: "data-delete" },
      { call: "writeFile(path, key)", kind: "key-rotation" },
    ] as const;

    for (const operation of operations) {
      const expressions = [
        `const quotient = ${numerator} / ${operation.call} / divisor;`,
        `return value / ${operation.call} / divisor;`,
        `return value /* numerator */ / ${operation.call} / divisor;`,
        `consume(value / ${operation.call} / divisor);`,
        `const quotient = ${numerator}\n / ${operation.call}\n / divisor;`,
      ];

      for (const expression of expressions) {
        expect(
          classifyOneWay([file(expression.split("\n"))]).findings.map(
            (finding) => finding.kind
          )
        ).toEqual([operation.kind]);
      }
    }
  }
);

const Indent = Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 0 }));

it.effect.prop(
  "aa4db39 classifier landing is TwoWay even when indented",
  [Indent],
  ([width]) =>
    Effect.gen(function* classifierLanding() {
      const fs = yield* FileSystem.FileSystem;

      const text = yield* fs.readFileString(
        new URL("fixtures/one-way/classifier-land.diff", import.meta.url)
          .pathname
      );

      const diff = parseUnifiedDiff(text);

      expect(diff).toHaveLength(1);
      expect(diff[0]?.path).toBe("stacks/nest/one-way.ts");

      const indented = diff.map((change) => ({
        ...change,
        added: change.added.map((line) => `${" ".repeat(width)}${line}`),
      }));

      const classification = classifyOneWay(indented);

      expect(classification.findings).toEqual([]);
      expect(oneWayAnswer(classification, [], "")._tag).toBe("TwoWay");
    }).pipe(Effect.provide(NodeServices.layer))
);
