import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Fiber, Option, Ref, Schema } from "effect";
import { expect } from "vitest";

import {
  clampKeep,
  planRetention,
  pruneReleases,
  pruneSafely,
} from "../../../stacks/nest/ship-prune.ts";
import type { ReleaseEntry } from "../../../stacks/nest/ship-prune.ts";

const shas = Array.from({ length: 8 }, (_, index) =>
  index.toString(16).repeat(40)
);

const attempts = ["attempt-aaaaaa", "attempt-Bb1234", "attempt-zzzzzz"];

const unknownNames = [
  "README",
  "attempt-12",
  "ABCDEF".repeat(7).slice(0, 40),
  "notes.install.log",
  `${shas[0]}.install.log.bak`,
];

const names = [
  ...shas,
  ...shas.map((sha) => `${sha}.install.log`),
  ...attempts,
  ...unknownNames,
];

const Entry = Schema.Struct({
  kind: Schema.Literals(["directory", "file", "other"]),
  mtime: Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 0 })),
  name: Schema.Literals(names),
});

const Receipt = Schema.Struct({
  result: Schema.Literals(["success", "failed", "deferred"]),
  sha: Schema.Literals(shas),
});

const Scenario = Schema.Struct({
  attempt: Schema.Literals(["", ...attempts]),
  current: Schema.Literals(["", ...shas]),
  entries: Schema.Array(Entry),
  keep: Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 0 })),
  receipts: Schema.Array(Receipt),
});

const unique = (entries: readonly ReleaseEntry[]) => [
  ...new Map(entries.map((entry) => [entry.name, entry])).values(),
];

const isRelease = (entry: ReleaseEntry) =>
  entry.kind === "directory" && shas.includes(entry.name);

it.prop(
  "retention keeps deployed, previous, current and at most N others, and never removes what it cannot classify",
  [Scenario],
  ([scenario]) => {
    const entries = unique(scenario.entries);

    const plan = planRetention(
      entries,
      scenario.receipts,
      { attempt: scenario.attempt, sha: scenario.current },
      scenario.keep
    );

    const removed = new Set(plan.remove);
    const kept = entries.filter((entry) => !removed.has(entry.name));

    const successes = scenario.receipts
      .filter((receipt) => receipt.result === "success")
      .map((receipt) => receipt.sha);

    const deployed = successes.at(-1);
    const previous = successes.findLast((sha) => sha !== deployed);

    const pinned = new Set(
      [deployed, previous, scenario.current].filter(
        (sha): sha is string => sha !== undefined && sha !== ""
      )
    );

    for (const entry of entries.filter(isRelease)) {
      if (pinned.has(entry.name)) {
        expect(removed.has(entry.name)).toBe(false);
      }
    }

    expect(
      kept.filter((entry) => isRelease(entry) && !pinned.has(entry.name)).length
    ).toBeLessThanOrEqual(clampKeep(scenario.keep));

    for (const entry of entries) {
      const known =
        isRelease(entry) ||
        (entry.kind === "directory" && attempts.includes(entry.name)) ||
        (entry.kind === "file" &&
          entry.name.endsWith(".install.log") &&
          shas.includes(entry.name.slice(0, 40)));

      if (!known) {
        expect(removed.has(entry.name)).toBe(false);
      }
    }

    if (scenario.attempt !== "") {
      expect(removed.has(scenario.attempt)).toBe(false);
    }
  }
);

const listing = (fs: FileSystem.FileSystem, directory: string) =>
  fs.readDirectory(directory).pipe(Effect.map((found) => found.toSorted()));

const receiptsFile = (rows: readonly (readonly [string, string])[]) =>
  rows
    .map(
      ([sha, result]) =>
        `${JSON.stringify({ celldRestarted: null, end: 1, restartSeconds: null, result, sha, start: 0 })}\n`
    )
    .join("");

const seed = Effect.fn("seed")(function* seed(
  fs: FileSystem.FileSystem,
  directory: string
) {
  for (const sha of shas) {
    yield* fs.makeDirectory(`${directory}/${sha}/node_modules`, {
      recursive: true,
    });
    yield* fs.writeFileString(`${directory}/${sha}.install.log`, "log");
    yield* Effect.sleep("5 millis");
  }

  yield* fs.makeDirectory(`${directory}/attempt-aaaaaa`);
  yield* fs.makeDirectory(`${directory}/attempt-zzzzzz`);
  yield* fs.writeFileString(`${directory}/README`, "mine");
});

it.live(
  "after a success prune leaves exactly deployed, previous, current and the newest others; a failure keeps deployed and previous",
  () =>
    Effect.gen(function* integration() {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const releases = `${root}/releases`;
      const outside = `${root}/outside`;
      yield* fs.makeDirectory(releases);
      yield* fs.makeDirectory(outside);
      yield* fs.writeFileString(`${outside}/precious`, "x");
      yield* seed(fs, releases);
      yield* fs.symlink(outside, `${releases}/${"f".repeat(40)}`);

      const receipts = `${root}/receipts.jsonl`;

      yield* fs.writeFileString(
        receipts,
        receiptsFile([
          [shas[1] ?? "", "success"],
          [shas[2] ?? "", "success"],
          [shas[3] ?? "", "failed"],
        ])
      );

      const logged = yield* Ref.make<ReadonlySet<string>>(new Set());

      const fiber = yield* pruneReleases(
        { keep: 2, receipts, releases },
        { attempt: "attempt-zzzzzz", sha: shas[3] ?? "" },
        logged
      );

      yield* Fiber.join(fiber);

      const left = yield* listing(fs, releases);

      expect(left).toEqual(
        [
          "README",
          "attempt-zzzzzz",
          "f".repeat(40),
          ...[1, 2, 3, 6, 7].flatMap((index) => [
            shas[index] ?? "",
            `${shas[index]}.install.log`,
          ]),
          ...[0, 4, 5].map((index) => `${shas[index]}.install.log`),
        ].toSorted()
      );

      expect(yield* fs.exists(`${outside}/precious`)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.live(
  "a failed ship keeps the deployed and previous-success release dirs",
  () =>
    Effect.gen(function* failure() {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const releases = `${root}/releases`;
      yield* fs.makeDirectory(releases);
      yield* seed(fs, releases);
      yield* fs.makeDirectory(`${releases}/${"f".repeat(40)}`);
      const receipts = `${root}/receipts.jsonl`;

      yield* fs.writeFileString(
        receipts,
        receiptsFile([
          [shas[0] ?? "", "success"],
          [shas[1] ?? "", "success"],
          ["f".repeat(40), "failed"],
        ])
      );

      yield* fs.utimes(`${releases}/${shas[0]}`, 0, 0);

      const fiber = yield* pruneReleases(
        { keep: 2, receipts, releases },
        { attempt: "", sha: "f".repeat(40) },
        yield* Ref.make<ReadonlySet<string>>(new Set())
      );

      yield* Fiber.join(fiber);
      const left = yield* listing(fs, releases);
      expect(left).toContain(shas[0]);
      expect(left).toContain(shas[1]);
      expect(left).toContain("f".repeat(40));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.live("a prune error never fails the ship", () =>
  Effect.gen(function* broken() {
    const outcome = yield* pruneSafely(
      {
        keep: 3,
        receipts: "/nonexistent/receipts",
        releases: "/nonexistent/r",
      },
      { attempt: "", sha: "" },
      yield* Ref.make<ReadonlySet<string>>(new Set())
    );

    expect(Option.isNone(outcome)).toBe(true);
  }).pipe(Effect.provide(NodeServices.layer))
);
