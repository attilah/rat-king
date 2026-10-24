import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  Console,
  Effect,
  FileSystem,
  Match,
  Path,
  Predicate,
  Schema,
} from "effect";
import { expect } from "vitest";

import {
  classifyOneWay,
  oneWayAnswer,
  oneWayExitCode,
  parseUnifiedDiff,
} from "../../../stacks/nest/one-way.ts";
import type {
  Classification,
  FileDiff,
  Finding,
} from "../../../stacks/nest/one-way.ts";
import {
  classifyShip,
  gitIn,
  inspectOneWay,
  shipJudgeCommand,
} from "../../../stacks/nest/ship-judge.ts";

const Small = Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 1 }));

const lexiconPath = "lexicons/sh/example/record.json";

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

const lexicon = (
  before: Schema.JsonObject,
  after: Schema.JsonObject
): FileDiff => ({
  ...file(lexiconPath, []),
  after: JSON.stringify(after),
  before: JSON.stringify(before),
});

const object = (
  body: Schema.JsonObject,
  required: readonly string[] = []
): Schema.JsonObject => ({
  defs: {
    main: {
      properties: { body, spare: { type: "string" } },
      required,
      type: "object",
    },
  },
  id: "sh.example.record",
  lexicon: 1,
});

it.prop(
  "an additive optional lexicon field never produces a finding, even when its own object is strict",
  [Schema.String],
  ([suffix]) => {
    const before = object({ type: "string" });

    const after: Schema.JsonObject = {
      defs: {
        main: {
          properties: {
            body: { type: "string" },
            [`optional_${suffix}`]: {
              properties: { inner: { type: "string" } },
              required: ["inner"],
              type: "object",
              "x-strict": true,
            },
            spare: { type: "string" },
          },
          required: [],
          type: "object",
        },
      },
      id: "sh.example.record",
      lexicon: 1,
    };

    const result = classifyOneWay([lexicon(before, after)]);

    expect(result.findings).toEqual([]);
    expect(result.info).toHaveLength(1);
    expect(result.info[0]?.kind).toBe("lexicon-widened");
  }
);

it.prop(
  "each tightening constraint produces a lexicon finding and prevents auto-revert",
  [Small],
  ([delta]) => {
    const pairs: readonly (readonly [Schema.JsonObject, Schema.JsonObject])[] =
      [
        ...["maxLength", "maxGraphemes", "maximum", "maxItems"].map(
          (key) =>
            [
              object({ [key]: delta + 1, type: "string" }),
              object({ [key]: 1, type: "string" }),
            ] as const
        ),
        ...["minLength", "minimum"].map(
          (key) =>
            [
              object({ [key]: 1, type: "string" }),
              object({ [key]: delta + 1, type: "string" }),
            ] as const
        ),
        ...["enum", "knownValues"].map(
          (key) =>
            [
              object({ [key]: ["a", "b"], type: "string" }),
              object({ [key]: ["a"], type: "string" }),
            ] as const
        ),
        [object({ type: "string" }), object({ type: "string" }, ["body"])],
        [
          object({ type: "string" }),
          {
            defs: {
              main: {
                properties: { body: { type: "string" } },
                type: "object",
              },
            },
          },
        ],
        [
          object({ type: "string" }),
          object({ type: "string", "x-strict": true }),
        ],
        [
          object({ const: "a", type: "string" }),
          object({ const: "b", type: "string" }),
        ],
      ];

    for (const [before, after] of pairs) {
      const result = classifyOneWay([lexicon(before, after)]);

      expect(
        result.findings.some((finding) => finding.kind === "lexicon-tightened")
      ).toBe(true);
      expect(
        classifyShip({
          findings: result.findings,
          oneWayCommits: [],
          paths: [],
        })._tag
      ).toBe("OneWay");
    }
  }
);

it.prop(
  "named content hazards are found outside tests and narrow limits only flag reductions",
  [Small],
  ([value]) => {
    const hazards = [
      {
        added: ["CREATE TABLE messages (id TEXT)"],
        kind: "do-migration",
        path: "apps/mailbox/src/sqlite.ts",
      },
      {
        added: [
          'const nextMigration = { new_sqlite_classes: ["New"], tag: "v4" };',
        ],
        kind: "do-migration",
        path: "apps/mailbox/src/bindings.ts",
      },
      {
        added: ["mailbox.retire(name)"],
        kind: "name-retirement",
        path: "apps/mailbox/cli/main.ts",
      },
      {
        added: ["storage.delete(id)"],
        kind: "data-delete",
        path: "apps/mailbox/src/store.ts",
      },
      {
        added: ["document.verificationMethod = next;"],
        kind: "key-rotation",
        path: "apps/mailbox/cli/identity.ts",
      },
    ] as const;

    for (const hazard of hazards) {
      expect(
        classifyOneWay([file(hazard.path, hazard.added)]).findings.map(
          (finding) => finding.kind
        )
      ).toContain(hazard.kind);
      expect(
        classifyOneWay([file(`tests/${hazard.path}`, hazard.added)]).findings
      ).toEqual([]);
    }

    const lowered = [
      file(
        "packages/client/src/wire.ts",
        ["export const MAX_BODY = 0;"],
        [`export const MAX_BODY = ${value};`]
      ),
      file("config/stage.json", ['"slots": 0'], [`"slots": ${value}`]),
      file(
        "apps/client/src/schema.ts",
        ["Schema.isMaxLength(0)"],
        [`Schema.isMaxLength(${value})`]
      ),
    ];

    expect(
      classifyOneWay(lowered).findings.map((finding) => finding.kind)
    ).toEqual(["wire-cap-lowered", "limit-lowered", "limit-lowered"]);
    expect(
      classifyOneWay(
        lowered.map((diff) => ({
          ...diff,
          added: diff.removed,
          removed: diff.added,
        }))
      ).findings
    ).toEqual([]);
    expect(
      classifyOneWay([
        file("apps/mailbox/src/bindings.ts", ["readonly NEW: string;"]),
      ]).findings[0]?.kind
    ).toBe("path");
  }
);

const finding: Finding = {
  detail: "MAX_BODY: 2 -> 1",
  kind: "wire-cap-lowered",
  path: "apps/client/wire.ts",
};

const classification: Classification = { findings: [finding], info: [] };

it.prop(
  "only carrier trailers or the merge trailer stage findings, and unstaged answers exit four",
  [Schema.Array(Schema.Boolean).check(Schema.isMinLength(1)), Schema.Boolean],
  ([staged, merge]) => {
    const commits = staged.map((present, index) => ({
      ...classification,
      sha: `${index}`,
      trailer: present ? "readers widened first" : "",
    }));

    commits.push({
      findings: [],
      info: [],
      sha: "unrelated",
      trailer: "irrelevant staging plan",
    });

    const answer = oneWayAnswer(
      classification,
      commits,
      merge ? "expanded readers in prior release" : ""
    );

    expect(Predicate.isTagged(answer, "OneWay")).toBe(true);

    if (Predicate.isTagged(answer, "OneWay")) {
      expect(answer.staged).toBe(merge || staged.every(Boolean));
      expect(oneWayExitCode(answer)).toBe(answer.staged ? 0 : 4);
    }

    const mergeOnly = oneWayAnswer(
      { findings: [{ ...finding, kind: "data-delete" }], info: [] },
      commits,
      ""
    );

    if (Predicate.isTagged(mergeOnly, "OneWay")) {
      expect(mergeOnly.staged).toBe(false);
    }
  }
);

interface Snapshot {
  readonly after: string;
  readonly before: string | null;
  readonly path: string;
}

const fixture = (name: string) =>
  Effect.gen(function* readFixture() {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.readFileString(
      new URL(`fixtures/one-way/${name}`, import.meta.url).pathname
    );
  });

it.effect.prop(
  "real attention, turn-record and digest diffs preserve additive compatibility",
  [Schema.Literals(["attention", "turn", "digest"])],
  ([name]) =>
    Effect.gen(function* historyFixture() {
      const diff = parseUnifiedDiff(yield* fixture(`${name}.diff`));

      let snapshots: readonly Snapshot[];

      if (name === "digest") {
        snapshots = [
          {
            after: yield* fixture("digest.after.json.txt"),
            before: yield* fixture("digest.before.json.txt"),
            path: "lexicons/sh/mschf/ratking/attention/prefs.json",
          },
        ];
      } else if (name === "turn") {
        snapshots = [
          {
            after: yield* fixture("turn.after.json.txt"),
            before: null,
            path: "lexicons/sh/mschf/agentgraph/turn.json",
          },
        ];
      } else {
        snapshots = [
          {
            after: yield* fixture("attention.after.json.txt"),
            before: null,
            path: "lexicons/sh/mschf/ratking/attention/prefs.json",
          },
          {
            after: yield* fixture("list.after.json.txt"),
            before: yield* fixture("list.before.json.txt"),
            path: "lexicons/sh/mschf/ratking/mailbox/list.json",
          },
        ];
      }

      const hydrated = diff.flatMap((change) => {
        const snapshot = snapshots.find((entry) => entry.path === change.path);

        return snapshot === undefined ? [] : [{ ...change, ...snapshot }];
      });

      expect(hydrated.length).toBe(snapshots.length);
      expect(classifyOneWay(hydrated).findings).toEqual([]);

      if (name === "digest") {
        expect(
          classifyOneWay(hydrated).info.some((entry) =>
            entry.detail.includes("digest")
          )
        ).toBe(true);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

const gitConfig = [
  "-c",
  "user.name=fixture",
  "-c",
  "user.email=fixture",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

const capturedCommand = (args: readonly string[]) =>
  Effect.gen(function* captureCommand() {
    const output: string[] = [];

    const code = yield* shipJudgeCommand(args).pipe(
      Effect.provideService(Console.Console, {
        ...console,
        error: () => {},
        log: (...values: readonly unknown[]) => {
          output.push(values.join(" "));
        },
      })
    );

    return { code, output };
  });

it.effect.prop(
  "real git and CLI stage only the finding commit or merge, and never declare findings revertible",
  [Schema.Literals(["none", "carrier", "unrelated", "merge", "empty"])],
  ([where]) =>
    Effect.gen(function* stagingContract() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const git = yield* gitIn(directory);
      const run = (args: readonly string[]) => git.run([...gitConfig, ...args]);

      yield* run(["init", "-q", "-b", "main"]);
      yield* fs.makeDirectory(path.join(directory, "apps/client/src"), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(directory, "apps/client/src/wire.ts"),
        "export const MAX_BODY = 10;\n"
      );
      yield* run(["add", "apps/client/src/wire.ts"]);
      yield* run(["commit", "-q", "-m", "seed"]);

      const base = (yield* run(["rev-parse", "HEAD"])).trim();

      yield* run(["checkout", "-q", "-b", "lane"]);
      yield* fs.writeFileString(
        path.join(directory, "apps/client/src/wire.ts"),
        "export const MAX_BODY = 1;\n"
      );
      yield* run(["add", "apps/client/src/wire.ts"]);
      yield* run([
        "commit",
        "-q",
        "-m",
        Match.value(where).pipe(
          Match.when(
            "carrier",
            () => "lower cap\n\nOne-way: widen readers first"
          ),
          Match.when("empty", () => "lower cap\n\nOne-way:"),
          Match.orElse(() => "lower cap")
        ),
      ]);
      yield* fs.writeFileString(
        path.join(directory, "README.md"),
        "unrelated\n"
      );
      yield* run(["add", "README.md"]);
      yield* run([
        "commit",
        "-q",
        "-m",
        where === "unrelated" ? "docs\n\nOne-way: irrelevant plan" : "docs",
      ]);
      yield* run(["checkout", "-q", "main"]);
      yield* run([
        "merge",
        "-q",
        "--no-ff",
        "-m",
        where === "merge" ? "merge\n\nOne-way: readers expanded" : "merge",
        "lane",
      ]);

      const head = (yield* run(["rev-parse", "HEAD"])).trim();
      const range = `${base}..${head}`;
      const staged = where === "carrier" || where === "merge";
      const { answer } = yield* inspectOneWay(git, range);

      expect(answer._tag).toBe("OneWay");

      if (Predicate.isTagged(answer, "OneWay")) {
        expect(answer.staged).toBe(staged);
      }

      const judged = yield* capturedCommand([
        "--one-way",
        range,
        "--repo",
        directory,
      ]);

      const reverted = yield* capturedCommand([
        "--revertible",
        range,
        "--repo",
        directory,
      ]);

      const replay = yield* capturedCommand([
        "--one-way-replay",
        "--last",
        "30",
        "--repo",
        directory,
      ]);

      expect(judged.code).toBe(staged ? 0 : 4);
      expect(judged.output.join("\n")).toContain('"wire-cap-lowered"');
      expect(reverted.code).toBe(1);
      expect(reverted.output.join("\n")).toContain('"_tag":"OneWay"');
      expect(replay.code).toBe(0);
      expect(replay.output).toEqual([
        `${head.slice(0, 12)} OneWay ${staged ? "staged" : "UNSTAGED"} ${where === "none" || where === "empty" ? "wire-cap-lowered" : "path,wire-cap-lowered"}`,
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 } }
);

it.effect.prop(
  "bad one-way and replay inputs refuse instead of returning a verdict",
  [Schema.Literals(["range", "option", "count", "duplicate", "missing"])],
  ([mutation]) =>
    Effect.gen(function* refusalContract() {
      const args = Match.value(mutation).pipe(
        Match.when("range", () => ["--one-way", "main...HEAD"]),
        Match.when("option", () => ["--one-way", "--help..HEAD"]),
        Match.when("count", () => ["--one-way-replay", "--last", "0"]),
        Match.when("duplicate", () => [
          "--one-way-replay",
          "--one-way-replay",
          "--last",
          "30",
        ]),
        Match.when("missing", () => ["--one-way"]),
        Match.exhaustive
      );

      const result = yield* capturedCommand(args);

      expect(result.code).toBe(3);
      expect(result.output).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
);
