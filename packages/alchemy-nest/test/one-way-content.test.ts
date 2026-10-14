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

const file = (
  path: string,
  added: readonly string[],
  removed: readonly string[] = []
): FileDiff => ({
  added,
  after: null,
  before: null,
  newPath: path,
  oldPath: path,
  path,
  removed,
});

const operations = [
  {
    fresh: 'other["retire"](name);',
    kind: "name-retirement",
    line: 'mailbox["retire"](name);',
    path: "packages/client/src/retire.ts",
  },
  {
    fresh: "node apps/mailbox/cli/retire.ts --successor other",
    kind: "name-retirement",
    line: "node apps/mailbox/cli/retire.ts --successor next",
    path: "scripts/retire.sh",
  },
  {
    fresh: 'node "apps/mailbox/cli/retire.ts" --successor other',
    kind: "name-retirement",
    line: 'node "apps/mailbox/cli/retire.ts" --successor next',
    path: "scripts/retire.sh",
  },
  {
    fresh: "DELETE FROM other;",
    kind: "data-delete",
    line: "DELETE FROM messages;",
    path: "queries/store.sql",
  },
  {
    fresh: "retire(other);",
    kind: "name-retirement",
    line: "retire(name);",
    path: "packages/client/src/retire.ts",
  },
  {
    fresh: "other.retire(name);",
    kind: "name-retirement",
    line: "mailbox.retire(name);",
    path: "packages/client/src/retire.ts",
  },
  {
    fresh: 'Command.make("retire other", {});',
    kind: "name-retirement",
    line: 'Command.make("retire", {});',
    path: "apps/mailbox/cli/main.ts",
  },
  {
    fresh: "ratking retire --successor other",
    kind: "name-retirement",
    line: "ratking retire --successor next",
    path: "scripts/retire.sh",
  },
  {
    fresh: 'exec("ratking retire --successor other");',
    kind: "name-retirement",
    line: 'exec("ratking retire --successor next");',
    path: "scripts/retire.ts",
  },
  {
    fresh: "storage.delete(other);",
    kind: "data-delete",
    line: "storage.delete(id);",
    path: "packages/client/src/store.ts",
  },
  {
    fresh: "other.deleteAll();",
    kind: "data-delete",
    line: "storage.deleteAll();",
    path: "packages/client/src/store.ts",
  },
  {
    fresh: 'sql.exec("DELETE FROM other");',
    kind: "data-delete",
    line: 'sql.exec("DELETE FROM messages");',
    path: "packages/client/src/store.ts",
  },
  {
    fresh: 'sql.exec("DROP TABLE other");',
    kind: "data-delete",
    line: 'sql.exec("DROP TABLE messages");',
    path: "packages/client/src/store.ts",
  },
  {
    fresh: "document.verificationMethod = other;",
    kind: "key-rotation",
    line: "document.verificationMethod = next;",
    path: "packages/envelope/src/key.ts",
  },
  {
    fresh: "writeFile(other, key);",
    kind: "key-rotation",
    line: "writeFile(path, key);",
    path: "packages/envelope/src/key.ts",
  },
] as const;

it.prop(
  "real retirement, deletion and key-write call sites remain findings",
  [Schema.Boolean],
  ([multiline]) => {
    for (const operation of operations) {
      const lines = multiline
        ? operation.line.replace("(", "(\n").split("\n")
        : [operation.line];

      const result = classifyOneWay([file(operation.path, lines)]);

      expect(result.findings.map((finding) => finding.kind)).toEqual([
        operation.kind,
      ]);
    }
  }
);

it.prop(
  "normalized moved call-site lines cancel across paths without hiding a fresh operation",
  [Schema.Boolean],
  ([indent]) => {
    for (const operation of operations) {
      const oldPath = `old/${operation.path}`;

      const removal: FileDiff = {
        ...file(oldPath, [], [operation.line]),
        newPath: null,
      };

      const moved = indent ? `   ${operation.line}   ` : operation.line;

      const addition: FileDiff = {
        ...file(operation.path, [moved]),
        oldPath: null,
      };

      expect(classifyOneWay([removal, addition]).findings).toEqual([]);
      expect(
        classifyOneWay([
          removal,
          { ...addition, added: [moved, operation.fresh] },
        ]).findings.map((finding) => finding.kind)
      ).toEqual([operation.kind]);
    }
  }
);

it.prop(
  "prose, literal-only descriptions and comments are not operation call sites",
  [
    Schema.Literals([
      "retire(name)",
      "storage.delete(id)",
      "writeFile(path, key)",
      "verificationMethod: next",
      "ratking retire",
      "DELETE FROM messages",
    ]),
  ],
  ([text]) => {
    const paths = [
      "packages/client/src/tool.ts",
      "packages/envelope/src/key.ts",
      "packages/envelope/README.md",
      "packages/envelope/notes.svx",
    ];

    const lines = [
      JSON.stringify(text),
      `const description = ${JSON.stringify(text)};`,
      `description: ${JSON.stringify(text)},`,
      `// ${text}`,
      `/* ${text} */`,
      "const description = `",
      text,
      "`;",
      "function* retire(name) { return name; }",
    ];

    for (const path of paths) {
      expect(classifyOneWay([file(path, lines)]).findings).toEqual([]);
    }
  }
);

it.prop(
  "language-specific SQL and script comments are not invocations",
  [
    Schema.Literals([
      "# ratking retire",
      "# storage.delete(id)",
      "-- DELETE FROM messages",
      "-- DROP TABLE messages",
    ]),
  ],
  ([comment]) => {
    for (const path of [
      "scripts/check.sh",
      "scripts/check.py",
      "queries/check.sql",
    ]) {
      const line = path.endsWith(".sql")
        ? comment.replace(/^#/u, "--")
        : comment.replace(/^--/u, "#");

      expect(classifyOneWay([file(path, [line])]).findings).toEqual([]);
    }
  }
);

it.effect.prop(
  "the real description edit and moved retire handler are TwoWay",
  [Schema.Literals(["retire-description", "retire-move"])],
  ([name]) =>
    Effect.gen(function* historyContent() {
      const fs = yield* FileSystem.FileSystem;

      const text = yield* fs.readFileString(
        new URL(`fixtures/one-way/${name}.diff`, import.meta.url).pathname
      );

      const diff = parseUnifiedDiff(text);
      const classification = classifyOneWay(diff);

      expect(diff.length).toBe(2);
      expect(classification.findings).toEqual([]);
      expect(oneWayAnswer(classification, [], "")._tag).toBe("TwoWay");

      if (name === "retire-move") {
        expect(diff[0]?.removed).toEqual(diff[1]?.added);
        expect(
          diff[1]?.added.some((line) => line.includes("retire: Effect.fn"))
        ).toBe(true);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
