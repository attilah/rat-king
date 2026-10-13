import { Clock, Console, Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Status } from "./health.ts";
import { FleetError as JudgeError } from "./stage-config.ts";
import { decodeTrafficLine, fileLines, usageWindow } from "./usage.ts";
import type { WindowBounds } from "./usage.ts";

export const ShipLimits = {
  ackRateDropPoints: 2,
  latencyFactor: 2,
  latencySlackMs: 250,
  minimumSent: 20,
  restartSkipMs: 60_000,
  undeliveredSlack: 5,
  windowMinutes: 10,
} as const;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Observed = Schema.NullOr(Schema.Union([Schema.Finite, Schema.String]));

const observation = <const Tag extends string>(tag: Tag) =>
  Schema.TaggedStruct(tag, { limit: Observed, value: Observed });

export const AckRateDrop = observation("AckRateDrop");

export const LatencyRegression = observation("LatencyRegression");

export const Undelivered = observation("Undelivered");

export const ListenersMissing = observation("ListenersMissing");

export const HealthStatus = observation("HealthStatus");

export const InsufficientTraffic = observation("InsufficientTraffic");

export const HealthMissing = observation("HealthMissing");

export const ShipReason = Schema.Union([
  AckRateDrop,
  LatencyRegression,
  Undelivered,
  ListenersMissing,
  HealthStatus,
  InsufficientTraffic,
  HealthMissing,
]);

export type Reason = typeof ShipReason.Type;

export const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u));

export const ShipHealth = Schema.Struct({
  listeners: Schema.NullOr(Schema.Struct({ count: Count, expected: Count })),
  status: Status,
});

export type JudgeHealth = typeof ShipHealth.Type;

export const ShipWindow = Schema.Struct({
  ackLatency: Schema.Struct({
    p50: Schema.NullOr(Schema.Finite),
    p95: Schema.NullOr(Schema.Finite),
  }),
  acked: Count,
  delivered: Count,
  end: Schema.String,
  replays: Count,
  sent: Count,
  start: Schema.String,
  undelivered: Count,
});

export type WindowFacts = typeof ShipWindow.Type;

const verdictFields = {
  after: ShipWindow,
  baseline: ShipWindow,
  reasons: Schema.Array(ShipReason),
  sha: Sha,
};

export const Pass = Schema.TaggedStruct("Pass", verdictFields);

export const Fail = Schema.TaggedStruct("Fail", verdictFields);

export const Unknown = Schema.TaggedStruct("Unknown", verdictFields);

export const ShipVerdict = Schema.Union([Pass, Fail, Unknown]);

export type Verdict = typeof ShipVerdict.Type;

export const verdictExitCode = { Fail: 1, Pass: 0, Unknown: 2 } as const;

export const refusalExitCode = 3;

export const Refused = Schema.TaggedStruct("Refused", {
  error: Schema.String,
  reason: Schema.NullOr(Schema.String),
});

export const shipWindows = (
  shippedAt: number,
  windowMinutes: number,
  baselineEnd = shippedAt
) => {
  const span = windowMinutes * 60_000;
  const after = shippedAt + ShipLimits.restartSkipMs;

  return {
    after: { end: after + span, start: after },
    baseline: { end: baselineEnd, start: baselineEnd - span },
  } satisfies Record<string, WindowBounds>;
};

const trafficReasons = (baseline: WindowFacts, after: WindowFacts) => {
  const reasons: Reason[] = [];

  const lostPoints =
    100 * (baseline.acked * after.sent - after.acked * baseline.sent);

  const scale = baseline.sent * after.sent;

  if (lostPoints > ShipLimits.ackRateDropPoints * scale) {
    reasons.push(
      AckRateDrop.make({
        limit: ShipLimits.ackRateDropPoints,
        value: lostPoints / scale,
      })
    );
  }

  const before = baseline.ackLatency.p95;
  const now = after.ackLatency.p95;

  if (before !== null && now !== null) {
    const limit = ShipLimits.latencyFactor * before + ShipLimits.latencySlackMs;

    if (now > limit) {
      reasons.push(LatencyRegression.make({ limit, value: now }));
    }
  }

  const undeliveredLimit = baseline.undelivered + ShipLimits.undeliveredSlack;

  if (after.undelivered > undeliveredLimit) {
    reasons.push(
      Undelivered.make({ limit: undeliveredLimit, value: after.undelivered })
    );
  }

  return reasons;
};

const healthReasons = ({ listeners, status }: JudgeHealth) => [
  ...(listeners !== null && listeners.count < listeners.expected
    ? [
        ListenersMissing.make({
          limit: listeners.expected,
          value: listeners.count,
        }),
      ]
    : []),
  ...(status === "ok"
    ? []
    : [HealthStatus.make({ limit: "ok", value: status })]),
];

export const judgeShip = (input: {
  readonly after: WindowFacts;
  readonly baseline: WindowFacts;
  readonly health: JudgeHealth | null;
  readonly sha: string;
}): Verdict => {
  const { after, baseline, health, sha } = input;
  const quietest = Math.min(baseline.sent, after.sent);
  const judgeable = quietest >= ShipLimits.minimumSent;

  const unknownCauses = [
    ...(judgeable
      ? []
      : [
          InsufficientTraffic.make({
            limit: ShipLimits.minimumSent,
            value: quietest,
          }),
        ]),
    ...(health === null || health.listeners === null
      ? [HealthMissing.make({ limit: null, value: null })]
      : []),
  ];

  const failures = [
    ...(judgeable ? trafficReasons(baseline, after) : []),
    ...(health === null ? [] : healthReasons(health)),
  ];

  const fields = {
    after,
    baseline,
    reasons: [...unknownCauses, ...failures],
    sha,
  };

  if (unknownCauses.length > 0) {
    return Unknown.make(fields);
  }

  return failures.length > 0 ? Fail.make(fields) : Pass.make(fields);
};

export const OneWayPaths = [
  { label: "lexicon", test: (path: string) => path.startsWith("lexicons/") },
  {
    label: "migration",
    test: (path: string) =>
      /(?:^|\/)[^/]*migrations?(?:\/|[^/]*$)/iu.test(path),
  },
  {
    label: "durable-object-migrations",
    test: (path: string) => path === "apps/mailbox/src/bindings.ts",
  },
  {
    label: "durable-object-schema",
    test: (path: string) => path === "apps/mailbox/src/sqlite.ts",
  },
] as const;

export const Revertible = Schema.TaggedStruct("Revertible", {});

export const OneWay = Schema.TaggedStruct("OneWay", {
  commits: Schema.Array(Sha),
  paths: Schema.Array(Schema.String),
});

export const NotTipMerge = Schema.TaggedStruct("NotTipMerge", {
  sha: Sha,
  tip: Schema.String,
});

export const Revertibility = Schema.Union([Revertible, OneWay, NotTipMerge]);

export const classifyShip = (input: {
  readonly oneWayCommits: readonly string[];
  readonly paths: readonly string[];
}) => {
  const paths = input.paths.filter((path) =>
    OneWayPaths.some((rule) => rule.test(path))
  );

  return paths.length === 0 && input.oneWayCommits.length === 0
    ? Revertible.make({})
    : OneWay.make({ commits: [...input.oneWayCommits], paths });
};

export interface Git {
  readonly run: (args: readonly string[]) => Effect.Effect<string, JudgeError>;
}

const nonEmptyLines = (text: string) =>
  text.split("\n").filter((line) => line.length > 0);

export const revertibility = Effect.fn("ShipJudge.revertibility")(
  function* revertibility(git: Git, range: string) {
    const match = /^(?<base>[^.\s]+)\.\.(?<sha>[0-9a-f]{40})$/u.exec(range);
    const base = match?.groups?.base;
    const sha = match?.groups?.sha;

    if (base === undefined || sha === undefined) {
      return yield* new JudgeError({
        reason: "Expected --revertible <base>..<40-hex sha>",
      });
    }

    const resolve = (ref: string) =>
      git
        .run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
        .pipe(Effect.map((out) => out.trim()));

    const tip = yield* resolve("HEAD");

    const [, firstParent, ...otherParents] = (yield* git.run([
      "rev-list",
      "--parents",
      "-n",
      "1",
      sha,
    ]))
      .trim()
      .split(" ");

    if (
      tip !== sha ||
      otherParents.length === 0 ||
      firstParent !== (yield* resolve(base))
    ) {
      return NotTipMerge.make({ sha, tip });
    }

    const paths = nonEmptyLines(
      yield* git.run([
        "diff",
        "--name-only",
        "--no-renames",
        `${firstParent}..${sha}`,
      ])
    );

    const trailers = nonEmptyLines(
      yield* git.run([
        "log",
        "--format=%H%x09%(trailers:key=One-way,valueonly,separator=%x3B,unfold)",
        `${firstParent}..${sha}`,
      ])
    );

    const oneWayCommits = trailers.flatMap((line) => {
      const [commit = "", value = ""] = line.split("\t");

      return value.trim().length > 0 ? [commit] : [];
    });

    return classifyShip({ oneWayCommits, paths });
  }
);

export const repositoryEnvironment = (
  environment: Readonly<Record<string, string | undefined>>
) =>
  Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith("GIT_"))
  );

export const gitIn = Effect.fn("ShipJudge.gitIn")(function* gitIn(
  directory: string
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const env = repositoryEnvironment(process.env);

  return {
    run: (args) =>
      Effect.gen(function* runGit() {
        const [out, code] = yield* Effect.scoped(
          Effect.gen(function* spawnGit() {
            const handle = yield* spawner.spawn(
              ChildProcess.make("git", ["-C", directory, ...args], {
                env,
                extendEnv: false,
                stdin: "ignore",
              })
            );

            return yield* Effect.all(
              [
                handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
                handle.exitCode,
                Stream.runDrain(handle.stderr),
              ],
              { concurrency: "unbounded" }
            );
          })
        ).pipe(
          Effect.mapError(() => new JudgeError({ reason: "git did not run" }))
        );

        if (code !== 0) {
          return yield* new JudgeError({
            reason: `git ${args[0] ?? ""} exited ${code}`,
          });
        }

        return out;
      }),
  } satisfies Git;
});

const usageText =
  "Usage: ship-judge --sha <40hex> --shipped-at <ISO> --input <traffic.jsonl> [--window-minutes 10] [--baseline-end <ISO>] [--health <health.json>] | ship-judge --revertible <base>..<sha> [--repo <dir>]";

const parseFlags = (args: readonly string[], known: readonly string[]) => {
  const flags = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];

    if (
      flag === undefined ||
      !known.includes(flag) ||
      value === undefined ||
      value.startsWith("--") ||
      flags.has(flag)
    ) {
      return null;
    }

    flags.set(flag, value);
  }

  return flags;
};

const Instant = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u)
);

const WindowMinutes = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isBetween({ maximum: 120, minimum: 1 })
);

const judgeVerdict = Effect.fn("ShipJudge.verdict")(function* judgeVerdict(
  flags: ReadonlyMap<string, string>
) {
  const sha = yield* Schema.decodeUnknownEffect(Sha)(flags.get("--sha"));

  const shipped = yield* Schema.decodeUnknownEffect(Instant)(
    flags.get("--shipped-at")
  );

  const baselineEnd = yield* Schema.decodeUnknownEffect(Instant)(
    flags.get("--baseline-end") ?? shipped
  );

  const input = flags.get("--input");
  const shippedAt = Date.parse(shipped);
  const incidentBaseline = Date.parse(baselineEnd);

  const minutes = yield* Schema.decodeEffect(WindowMinutes)(
    flags.get("--window-minutes") ?? `${ShipLimits.windowMinutes}`
  );

  if (
    input === undefined ||
    !Number.isFinite(shippedAt) ||
    !Number.isFinite(incidentBaseline)
  ) {
    return yield* new JudgeError({ reason: usageText });
  }

  if (incidentBaseline > shippedAt) {
    return yield* new JudgeError({
      reason: "Baseline must end at or before the ship",
    });
  }

  const windows = shipWindows(shippedAt, minutes, incidentBaseline);

  if ((yield* Clock.currentTimeMillis) < windows.after.end) {
    return yield* new JudgeError({ reason: "After window is still open" });
  }

  const fs = yield* FileSystem.FileSystem;
  const healthPath = flags.get("--health");

  const health =
    healthPath === undefined
      ? null
      : yield* fs
          .readFileString(healthPath)
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.fromJsonString(ShipHealth))
            )
          );

  const window = (bounds: WindowBounds) =>
    usageWindow(
      bounds,
      fileLines(fs, input).pipe(Stream.mapEffect(decodeTrafficLine))
    );

  return judgeShip({
    after: yield* window(windows.after),
    baseline: yield* window(windows.baseline),
    health,
    sha,
  });
});

const refuse = (error: string, reason: string | null) =>
  Console.error(JSON.stringify(Refused.make({ error, reason }))).pipe(
    Effect.as(refusalExitCode)
  );

export const shipJudgeCommand = (args: readonly string[]) =>
  Effect.gen(function* shipJudge() {
    if (args.includes("--revertible")) {
      const flags = parseFlags(args, ["--revertible", "--repo"]);
      const range = flags?.get("--revertible");

      if (flags === null || range === undefined) {
        return yield* new JudgeError({ reason: usageText });
      }

      const answer = yield* revertibility(
        yield* gitIn(flags.get("--repo") ?? "."),
        range
      );

      yield* Console.log(JSON.stringify(answer));

      return Schema.is(Revertible)(answer) ? 0 : 1;
    }

    const flags = parseFlags(args, [
      "--sha",
      "--shipped-at",
      "--baseline-end",
      "--input",
      "--window-minutes",
      "--health",
    ]);

    if (flags === null) {
      return yield* new JudgeError({ reason: usageText });
    }

    const verdict = yield* judgeVerdict(flags);
    yield* Console.log(JSON.stringify(verdict));

    return verdictExitCode[verdict._tag];
  }).pipe(
    Effect.catchTags({
      FleetError: ({ reason }) => refuse("FleetError", reason),
      ForbiddenField: ({ field }) => refuse("ForbiddenField", field),
      PlatformError: () => refuse("PlatformError", null),
      SchemaError: () => refuse("SchemaError", null),
    })
  );
