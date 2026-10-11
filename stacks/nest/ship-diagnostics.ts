const reasons = [
  "Only a matching file may be adopted",
  "Only a matching unit may be adopted",
  "Existing file requires explicit adoption",
  "Existing unit requires explicit adoption",
  "Only the pinned binary may be adopted",
  "Adoption requires the inventory-owned mode-700 root",
  "Adoption refuses non-private or redirected parent directories",
  "Prior deployment file ownership could not be verified",
  "Unit changed outside its qualified owner; staging refused",
  "Remote command failed; values redacted",
  "Storage readiness deadline exceeded before node startup",
  "Host listener approval required",
  "User unit failed readback",
  "Invalid stage configuration",
  "POC plan refuses delete or replace",
  "Ship command failed; values redacted",
  "Candidate checkout does not match the fenced SHA",
  "Candidate command failed",
  "NoIdentity",
  "LeaseHeld",
] as const;

const providers = [
  "RemoteFile.provider.read",
  "Celld.Deployment.reconcile",
  "SystemdUnit.reconcile",
  "Celld.Node.reconcile",
] as const;

const redactions: readonly (readonly [RegExp, string])[] = [
  [/\p{Cc}\[[0-9;?]*[A-Za-z]/gu, ""],
  [/[^\P{Cc}\n\t]/gu, ""],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gu,
    "<key>",
  ],
  [/\b(?:Bearer|Basic)\s+\S+/giu, "<token>"],
  [
    /\b(?:gh[pousr]_|github_pat_|sk-|xox[abpr]-|AKIA|eyJ)[\w./+=-]+/gu,
    "<token>",
  ],
  [
    /\b(?<name>[\w-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth)[\w-]*)(?<sep>["']?\s*[:=]\s*)\S+/giu,
    "$<name>$<sep><redacted>",
  ],
  [
    /\b(?:agent[-_]secrets[:/ ]+\S+|[a-z][a-z0-9_]*_(?:api_key|secret|token|password))\b/giu,
    "<secret-name>",
  ],
  [/(?<![\w+-])(?=[\w+-]*\d)(?=[\w+-]*[A-Za-z])[\w+-]{32,}={0,2}/gu, "<token>"],
  [/(?:\/Users|\/home)\/[A-Za-z0-9_.-]+/gu, "~"],
  [/(?:[a-z0-9*-]+\.)+ts\.net\b/giu, "<tailnet>"],
  [
    /(?<![\w.])[a-z0-9][a-z0-9-]*\.(?:local|internal|lan)(?![\w.])/giu,
    "<host>",
  ],
  [
    /[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu,
    "<email>",
  ],
  [/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/gu, "<ip>"],
  [/(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![\w:])/giu, "<ip>"],
  [
    /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){1,6}|:):(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![\w:])/giu,
    "<ip>",
  ],
];

export const redactStderrExcerpt = (raw: string): string => {
  let text = raw.slice(-65_536);

  for (const [pattern, replacement] of redactions) {
    text = text.replace(pattern, replacement);
  }

  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .slice(-15)
    .join("\n")
    .slice(-1500);
};

export const sanitizeCandidateStderr = (raw: string): string => {
  const tail = raw.slice(-65_536);
  const known = reasons.filter((reason) => tail.includes(reason));
  const frames = providers.filter((provider) => tail.includes(provider));

  const code =
    /\b(?:ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|ERR_MODULE_NOT_FOUND)\b/u.exec(
      tail
    )?.[0];

  const exit = /Candidate command failed \(exit (?<exit>\d+)\)/u.exec(tail)
    ?.groups?.exit;

  const parts = [
    ...known,
    ...frames,
    ...(code === undefined ? [] : [code]),
    ...(exit === undefined ? [] : [`exit ${exit}`]),
  ];

  return parts.length === 0
    ? redactStderrExcerpt(tail)
    : [...new Set(parts)].join("; ").slice(-2048);
};
