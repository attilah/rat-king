import { DateTime, Schema } from "effect";

import { readerVerdict } from "../../packages/pi-ratking/src/reader-health.ts";
import type { ReaderHeartbeatValue } from "../../packages/pi-ratking/src/reader-health.ts";
import { AlarmKey, AlarmReading } from "./alarm-config.ts";
import type { AlarmReadingValue } from "./alarm-config.ts";
import { Sha, ShipReceipt } from "./ship-config.ts";
import { sanitizeCandidateStderr } from "./ship-diagnostics.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const DeployMarker = Schema.Struct({
  phase: Schema.Literals(["restarting", "done"]),
  sha: Schema.optionalKey(Sha),
  started: Schema.Finite,
});

export const CacheBreach = Schema.Struct({
  fullRewrites: Count,
  host: Schema.String,
  hour: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  session: Schema.String,
});

export const ReaderSighting = Schema.Struct({
  host: Schema.String,
  idleSeconds: Count,
  lastError: Schema.NullOr(Schema.String),
  name: Schema.String,
  owner: Schema.NullOr(Schema.String),
  state: Schema.String,
  verdict: Schema.Literals(["running", "stuck"]),
});

export type ReaderSightingValue = typeof ReaderSighting.Type;

export const sightReaders = (
  host: string,
  beats: readonly {
    readonly alive: boolean;
    readonly beat: ReaderHeartbeatValue;
  }[],
  now: number
): ReaderSightingValue[] =>
  beats.flatMap(({ alive, beat }) => {
    const verdict = readerVerdict(beat, alive, now);

    if (verdict === "stale") {
      return [];
    }

    const progress = DateTime.toEpochMillis(
      beat.lastConsumeOk ?? beat.startedAt
    );

    return [
      {
        host,
        idleSeconds: Math.max(0, Math.floor((now - progress) / 1000)),
        lastError: beat.lastError,
        name: beat.name,
        owner: beat.owner ?? null,
        state: beat.state,
        verdict,
      },
    ];
  });

export const InstanceHealth = Schema.Union([
  Schema.Struct({
    name: Schema.NonEmptyString,
    page: Schema.optionalKey(Schema.Boolean),
    status: Schema.Literal("ok"),
  }),
  Schema.Struct({
    name: Schema.NonEmptyString,
    page: Schema.optionalKey(Schema.Boolean),
    reason: Schema.NonEmptyString,
    status: Schema.Literal("down"),
  }),
]);

export const BackupWindow = Schema.Struct({
  end: Schema.NullOr(Schema.Finite),
  start: Schema.Finite,
});

export const AlarmFacts = Schema.Struct({
  backup: Schema.optionalKey(Schema.NullOr(BackupWindow)),
  cacheBreaches: Schema.NullOr(Schema.Array(CacheBreach)),
  deploy: Schema.NullOr(DeployMarker),
  deployKnown: Schema.Boolean,
  digest: Schema.NullOr(Schema.Literals(["ok", "warn", "fail"])),
  doctor: Schema.Boolean,
  entered: Schema.NullOr(Schema.Finite),
  health: Schema.NullOr(Schema.Int),
  instances: Schema.optionalKey(Schema.Array(InstanceHealth)),
  measurementFailed: Schema.Boolean,
  quarantinedHour: Schema.NullOr(Count),
  readers: Schema.NullOr(
    Schema.Struct({
      complete: Schema.Boolean,
      seen: Schema.Array(ReaderSighting),
    })
  ),
  receipts: Schema.Array(ShipReceipt),
  receiptsKnown: Schema.Boolean,
  slots: Schema.NullOr(Schema.Struct({ free: Count, max: Count })),
});

export const SourceState = Schema.Struct({
  downChecks: Count,
  entered: Schema.NullOr(Schema.Finite),
  instanceDownChecks: Schema.optionalKey(Schema.Record(Schema.String, Count)),
  unexplained: Schema.Array(Schema.Finite),
});

export const emptySources: typeof SourceState.Type = {
  downChecks: 0,
  entered: null,
  unexplained: [],
};

export const Readings = Schema.Record(AlarmKey, AlarmReading);

const ok: AlarmReadingValue = { status: "ok" };

const unknown: AlarmReadingValue = { status: "unknown" };

const firing = (
  severity: "warn" | "critical",
  evidence: string
): AlarmReadingValue => ({ evidence, severity, status: "firing" });

export const RESTART_MEMORY_MS = 3_600_000;

export const deployWindow = (facts: typeof AlarmFacts.Type, now: number) => {
  const { deploy } = facts;

  return (
    deploy?.phase === "restarting" &&
    now >= deploy.started * 1000 &&
    now - deploy.started * 1000 < 180_000 &&
    !facts.receipts.some(
      (receipt) => receipt.sha === deploy.sha && receipt.end >= deploy.started
    )
  );
};

const trackSources = (
  prior: typeof SourceState.Type,
  facts: typeof AlarmFacts.Type,
  now: number
): typeof SourceState.Type => {
  const explains = (instant: number) =>
    facts.receipts.some(
      (receipt) =>
        receipt.start * 1000 <= instant && receipt.end * 1000 >= instant
    ) ||
    (facts.backup !== undefined &&
      facts.backup !== null &&
      facts.backup.start <= instant &&
      (facts.backup.end ?? now) >= instant);

  const unexplained = prior.unexplained.filter(
    (instant) => !explains(instant) && now - instant < RESTART_MEMORY_MS
  );

  if (
    facts.entered !== null &&
    prior.entered !== null &&
    facts.entered > prior.entered &&
    !explains(facts.entered)
  ) {
    unexplained.push(facts.entered);
  }

  const tracked = {
    downChecks:
      !facts.deployKnown || deployWindow(facts, now) || facts.health === 200
        ? 0
        : Math.min(prior.downChecks + 1, 2),
    entered: facts.entered ?? prior.entered,
    unexplained,
  };

  return facts.instances === undefined || facts.instances.length === 0
    ? tracked
    : {
        ...tracked,
        instanceDownChecks: Object.fromEntries(
          facts.instances.map((instance) => [
            instance.name,
            instance.status === "down"
              ? Math.min(
                  (prior.instanceDownChecks?.[instance.name] ?? 0) + 1,
                  2
                )
              : 0,
          ])
        ),
      };
};

const shipReading = (facts: typeof AlarmFacts.Type): AlarmReadingValue => {
  if (!facts.receiptsKnown) {
    return unknown;
  }

  const receipt = facts.receipts.at(-1);

  if (receipt?.result !== "failed") {
    return ok;
  }

  return firing(
    "warn",
    `sha ${receipt.sha}; ${sanitizeCandidateStderr(receipt.stderrTail ?? "")}`
  );
};

const slotReading = (facts: typeof AlarmFacts.Type): AlarmReadingValue => {
  if (facts.slots === null || facts.slots.max === 0) {
    return unknown;
  }

  const ratio = facts.slots.free / facts.slots.max;

  if (ratio >= 0.1) {
    return ok;
  }

  return firing(
    ratio < 0.05 ? "critical" : "warn",
    `${facts.slots.free}/${facts.slots.max} free slots`
  );
};

const readerReading = (facts: typeof AlarmFacts.Type): AlarmReadingValue => {
  if (facts.readers === null) {
    return unknown;
  }

  const stuck = facts.readers.seen.filter(
    (reader) => reader.verdict === "stuck"
  );

  if (stuck.length > 0) {
    const owners = stuck.flatMap((reader) =>
      reader.owner === null ? [] : [reader.owner]
    );

    return {
      evidence: `${stuck.length} live Pi readers made no lease or consume progress for over 5 minutes: ${stuck
        .map(
          (reader) =>
            `${reader.name} on ${reader.host} ${reader.state}${reader.lastError === null ? "" : ` (${reader.lastError})`} idle ${Math.floor(reader.idleSeconds / 60)}m`
        )
        .join("; ")}`,
      recipients: [...new Set(owners)],
      severity: "warn",
      status: "firing",
    };
  }

  return facts.readers.complete ? ok : unknown;
};

const instanceReading = (
  facts: typeof AlarmFacts.Type,
  sources: typeof SourceState.Type
): AlarmReadingValue => {
  const down = (facts.instances ?? []).filter(
    (instance) => instance.status === "down"
  );

  const pages = down.some(
    (instance) =>
      instance.page === true &&
      (sources.instanceDownChecks?.[instance.name] ?? 0) >= 2
  );

  return down.length === 0
    ? ok
    : firing(
        pages ? "critical" : "warn",
        down
          .map((instance) => `${instance.name}: ${instance.reason}`)
          .join("; ")
      );
};

const downReading = (
  facts: typeof AlarmFacts.Type,
  sources: typeof SourceState.Type,
  now: number
): AlarmReadingValue => {
  if (!facts.deployKnown || deployWindow(facts, now)) {
    return unknown;
  }

  if (sources.downChecks >= 2) {
    return firing(
      "critical",
      "Mailbox health was not 200 in two consecutive checks"
    );
  }

  return facts.health === 200 ? ok : unknown;
};

const restartReading = (
  facts: typeof AlarmFacts.Type,
  sources: typeof SourceState.Type,
  now: number
): AlarmReadingValue => {
  if (
    facts.entered === null ||
    !facts.receiptsKnown ||
    deployWindow(facts, now)
  ) {
    return unknown;
  }

  return sources.unexplained.length > 0
    ? firing(
        "warn",
        `${sources.unexplained.length} observed process starts lack an explaining ship receipt or backup run`
      )
    : ok;
};

const quarantineReading = (
  facts: typeof AlarmFacts.Type
): AlarmReadingValue => {
  if (facts.quarantinedHour === null) {
    return unknown;
  }

  return facts.quarantinedHour > 20
    ? firing(
        "warn",
        `${facts.quarantinedHour} new quarantine files in one hour`
      )
    : ok;
};

export const CACHE_PAGE_SESSIONS = 3;

const cacheReading = (
  facts: typeof AlarmFacts.Type,
  now: number
): AlarmReadingValue => {
  if (facts.cacheBreaches === null) {
    return unknown;
  }

  const current = facts.cacheBreaches.filter(
    (breach) => now - Date.parse(breach.hour) < 7_200_000
  );

  const sessions = [
    ...new Set(current.map((breach) => `${breach.host}/${breach.session}`)),
  ];

  if (sessions.length === 0) {
    return ok;
  }

  const worst = [
    ...new Map(
      current
        .toSorted((a, b) => a.fullRewrites - b.fullRewrites)
        .map((breach) => [`${breach.host}/${breach.session}`, breach] as const)
    ).values(),
  ]
    .toSorted((a, b) => b.fullRewrites - a.fullRewrites)
    .slice(0, 3)
    .map(
      (breach) =>
        `${breach.name ?? breach.session} on ${breach.host} ${breach.fullRewrites} rebuilds`
    )
    .join("; ");

  return firing(
    sessions.length >= CACHE_PAGE_SESSIONS ? "critical" : "warn",
    `${sessions.length} sessions did 10 or more full cache rebuilds in an hour: ${worst}`
  );
};

const digestReading = (facts: typeof AlarmFacts.Type): AlarmReadingValue => {
  if (facts.measurementFailed || facts.digest === "fail") {
    return firing(
      "warn",
      "Digest failed or an alarm measurement was unavailable"
    );
  }

  return facts.digest === null ? unknown : ok;
};

export const observeAlarms = (
  prior: typeof SourceState.Type,
  facts: typeof AlarmFacts.Type,
  now: number
) => {
  const sources = trackSources(prior, facts, now);

  const readings: typeof Readings.Type = {
    "cache.rewrites": cacheReading(facts, now),
    "celld.down": downReading(facts, sources, now),
    "celld.restarted": restartReading(facts, sources, now),
    "digest.fail": digestReading(facts),
    "filer.slots": slotReading(facts),
    "instance.down": instanceReading(facts, sources),
    "issuer.broken": facts.doctor
      ? ok
      : firing(
          "critical",
          "Configuration doctor failed; input values withheld"
        ),
    "quarantine.growth": quarantineReading(facts),
    "readers.stuck": readerReading(facts),
    "ship.failed": shipReading(facts),
  };

  return { readings, sources };
};
