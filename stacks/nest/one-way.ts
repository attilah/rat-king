import { Data, Option, Predicate, Schema } from "effect";

export type FindingKind =
  | "data-delete"
  | "do-migration"
  | "key-rotation"
  | "lexicon-tightened"
  | "limit-lowered"
  | "name-retirement"
  | "path"
  | "wire-cap-lowered";

export interface Finding {
  readonly detail: string;
  readonly kind: FindingKind;
  readonly path: string;
}

export interface Information {
  readonly detail: string;
  readonly kind: "lexicon-widened";
  readonly path: string;
}

export interface FileDiff {
  readonly added: readonly string[];
  readonly after: string | null;
  readonly before: string | null;
  readonly newPath: string | null;
  readonly oldPath: string | null;
  readonly path: string;
  readonly removed: readonly string[];
}

export interface Classification {
  readonly findings: readonly Finding[];
  readonly info: readonly Information[];
}

export type OneWayAnswer =
  | { readonly _tag: "TwoWay" }
  | ({ readonly _tag: "OneWay"; readonly staged: boolean } & Classification);

const Answer = Data.taggedEnum<OneWayAnswer>();

interface LexiconComparison {
  readonly tightened: readonly string[];
  readonly widened: readonly string[];
}

export interface CommitClassification extends Classification {
  readonly sha: string;
  readonly trailer: string;
}

export const fallbackPath = (path: string) =>
  path.startsWith("lexicons/") ||
  /(?:^|\/)[^/]*migrations?(?:\/|[^/]*$)/iu.test(path) ||
  path === "apps/mailbox/src/bindings.ts" ||
  path === "apps/mailbox/src/sqlite.ts";

const diffPath = (line: string) => {
  const value = line.slice(4).split("\t")[0] ?? "";

  const decoded = value.startsWith('"')
    ? Schema.decodeSync(Schema.fromJsonString(Schema.String))(value)
    : value;

  return decoded === "/dev/null" ? null : decoded.slice(2);
};

export const parseUnifiedDiff = (text: string): readonly FileDiff[] => {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  let inHunk = false;

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      current = undefined;
    } else if (!inHunk && line.startsWith("--- ")) {
      const oldPath = diffPath(line);
      current = {
        added: [],
        after: null,
        before: null,
        newPath: null,
        oldPath,
        path: oldPath ?? "",
        removed: [],
      };
    } else if (!inHunk && line.startsWith("+++ ") && current !== undefined) {
      const newPath = diffPath(line);
      current = { ...current, newPath, path: newPath ?? current.path };
      files.push(current);
    } else if (line.startsWith("@@ ")) {
      inHunk = true;
    } else if (inHunk && current !== undefined) {
      if (line.startsWith("+")) {
        current = { ...current, added: [...current.added, line.slice(1)] };
      } else if (line.startsWith("-")) {
        current = { ...current, removed: [...current.removed, line.slice(1)] };
      }

      files[files.length - 1] = current;
    }
  }

  return files;
};

const JsonObject = Schema.Record(Schema.String, Schema.Json);

const isRecord = Schema.is(JsonObject);

const isNumber = Schema.is(Schema.Finite);

const record = (value: Schema.Json | undefined): Schema.JsonObject | null =>
  isRecord(value) ? value : null;

const jsonRecord = (text: string | null) =>
  text === null
    ? null
    : Option.getOrNull(
        Schema.decodeOption(Schema.fromJsonString(JsonObject))(text)
      );

const values = (value: Schema.Json | undefined): Schema.JsonArray =>
  Schema.is(Schema.Array(Schema.Json))(value) ? value : [];

const lowerBounds = new Set([
  "maxLength",
  "maxGraphemes",
  "maximum",
  "maxItems",
]);

const upperBounds = new Set(["minLength", "minimum"]);

const boundTightened = (
  key: string,
  previous: Schema.Json | undefined,
  next: Schema.Json
) =>
  isNumber(previous) &&
  isNumber(next) &&
  ((lowerBounds.has(key) && next < previous) ||
    (upperBounds.has(key) && next > previous));

const constraintDetails = (
  before: Schema.JsonObject,
  after: Schema.JsonObject,
  location: string
): readonly string[] => {
  const details: string[] = [];

  for (const [key, next] of Object.entries(after)) {
    const previous = before[key];
    const label = `${location}/${key}`;

    if (boundTightened(key, previous, next)) {
      details.push(
        `${label}: ${JSON.stringify(previous)} -> ${JSON.stringify(next)}`
      );
    }

    if (
      key === "required" &&
      values(next).some((item) => !values(previous).includes(item))
    ) {
      details.push(`${label}: required property added`);
    }

    if (
      (key === "enum" || key === "knownValues") &&
      values(previous).some((item) => !values(next).includes(item))
    ) {
      details.push(`${label}: value removed`);
    }

    if (key === "x-strict" && !Object.hasOwn(before, key)) {
      details.push(`${label}: strict constraint added`);
    }

    if (
      key === "const" &&
      Object.hasOwn(before, key) &&
      JSON.stringify(previous) !== JSON.stringify(next)
    ) {
      details.push(`${label}: const changed`);
    }
  }

  for (const key of ["enum", "knownValues"]) {
    if (Object.hasOwn(before, key) && !Object.hasOwn(after, key)) {
      details.push(`${location}/${key}: value set removed`);
    }
  }

  return details;
};

const compareLexicon = (
  before: Schema.JsonObject,
  after: Schema.JsonObject,
  location = ""
): LexiconComparison => {
  const tightened = [...constraintDetails(before, after, location)];
  const widened: string[] = [];
  const oldProperties = record(before.properties) ?? {};
  const newProperties = record(after.properties) ?? {};

  for (const key of Object.keys(oldProperties)) {
    if (!Object.hasOwn(newProperties, key)) {
      tightened.push(`${location}/properties/${key}: property removed`);
    }
  }

  for (const key of Object.keys(newProperties)) {
    if (
      !Object.hasOwn(oldProperties, key) &&
      !values(after.required).includes(key)
    ) {
      widened.push(`${location}/properties/${key}: optional property added`);
    }
  }

  for (const [key, next] of Object.entries(after)) {
    const oldNode = record(before[key]);
    const newNode = record(next);

    if (oldNode !== null && newNode !== null) {
      const nested = compareLexicon(oldNode, newNode, `${location}/${key}`);
      tightened.push(...nested.tightened);
      widened.push(...nested.widened);
    }
  }

  return { tightened, widened };
};

const lexiconClassification = (file: FileDiff): Classification | null => {
  if (!/^lexicons\/.*\.json$/u.test(file.path)) {
    return null;
  }

  const before = jsonRecord(file.before);
  const after = jsonRecord(file.after);

  if (file.newPath === null && before !== null) {
    return {
      findings: [
        {
          detail: "lexicon removed",
          kind: "lexicon-tightened",
          path: file.path,
        },
      ],
      info: [],
    };
  }

  if (after === null || (file.oldPath !== null && before === null)) {
    return null;
  }

  const compared = compareLexicon(before ?? {}, after);

  return {
    findings: compared.tightened.map((detail) => ({
      detail,
      kind: "lexicon-tightened",
      path: file.path,
    })),
    info: compared.widened.map((detail) => ({
      detail,
      kind: "lexicon-widened",
      path: file.path,
    })),
  };
};

const testPath = (path: string) =>
  /(?:^|\/)(?:tests?|__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[^/]+$/u.test(
    path
  );

const sourcePath = (path: string) =>
  /\.(?:[cm]?[jt]sx?|sql|sh|py)$/u.test(path) && !testPath(path);

const numericAssignments = (text: string, pattern: RegExp) =>
  new Map(
    [...text.matchAll(pattern)].map((match) => [
      match.groups?.name ?? "",
      Number((match.groups?.value ?? "").replaceAll("_", "")),
    ])
  );

const lowered = (file: FileDiff, pattern: RegExp, kind: FindingKind) => {
  const before = numericAssignments(file.removed.join("\n"), pattern);
  const after = numericAssignments(file.added.join("\n"), pattern);

  return [...after].flatMap(([name, next]): readonly Finding[] => {
    const previous = before.get(name);

    return previous !== undefined && next < previous
      ? [{ detail: `${name}: ${previous} -> ${next}`, kind, path: file.path }]
      : [];
  });
};

const numericFindings = (file: FileDiff): readonly Finding[] => {
  if (testPath(file.path)) {
    return [];
  }

  const findings: Finding[] = [];

  if (/^(?:packages|apps)\//u.test(file.path) && sourcePath(file.path)) {
    findings.push(
      ...lowered(
        file,
        /\b(?:const|let)\s+(?<name>[\w$]*(?:MAX|LIMIT|CAP|TTL|WINDOW|BUDGET)[\w$]*)(?:\s*:\s*[\w.]+)?\s*=\s*(?<value>-?\d[\d_]*(?:\.\d+)?)/gu,
        "wire-cap-lowered"
      )
    );
  }

  if (
    /(?:config|schema|policy|stage|alarm)/iu.test(file.path) &&
    /\.(?:json|[cm]?[jt]s)$/u.test(file.path)
  ) {
    findings.push(
      ...lowered(
        file,
        /["']?\b(?<name>slots|threshold|limit|maxItems|maxLength|maximum|[\w$]*(?:Limit|Threshold|Slots|Budget|Cap|TTL))["']?\s*:\s*(?<value>-?\d[\d_]*(?:\.\d+)?)/gu,
        "limit-lowered"
      )
    );
  }

  if (sourcePath(file.path)) {
    findings.push(
      ...lowered(
        file,
        /\bSchema\.(?<name>isLessThanOrEqualTo|isLessThan|isMaxLength)\(\s*(?<value>-?\d[\d_]*(?:\.\d+)?)/gu,
        "limit-lowered"
      )
    );
  }

  return findings;
};

const contentFindings = (file: FileDiff): readonly Finding[] => {
  const findings = [...numericFindings(file)];
  const added = file.added.join("\n");
  const changed = [...file.added, ...file.removed].join("\n");

  const add = (kind: FindingKind, detail: string) => {
    findings.push({ detail, kind, path: file.path });
  };

  if (testPath(file.path)) {
    return findings;
  }

  if (
    (file.path === "apps/mailbox/src/sqlite.ts" ||
      /migration/iu.test(file.path)) &&
    /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TRIGGER|VIEW)\b/iu.test(changed)
  ) {
    add("do-migration", "DDL changed");
  }

  if (
    file.path === "apps/mailbox/src/bindings.ts" &&
    /\b(?:migrations|new_sqlite_classes|new_classes|deleted_classes|renamed_classes|[\w$]*Migration)\b/u.test(
      changed
    )
  ) {
    add("do-migration", "Durable Object migration entry changed");
  }

  if (
    sourcePath(file.path) &&
    /\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\.deleteAll\s*\(|\bstorage\.delete\s*\(/iu.test(
      added
    )
  ) {
    add("data-delete", "destructive storage operation added");
  }

  if (
    sourcePath(file.path) &&
    (/\bretire\s*\(|\bmailbox\.retire\b|\bratking\s+retire\b/u.test(added) ||
      (file.path === "apps/mailbox/cli/retire.ts" && added.length > 0))
  ) {
    add("name-retirement", "name retirement operation added");
  }

  if (
    /(?:^apps\/mailbox\/cli\/(?:identity|secrets)\.ts$|^packages\/envelope\/|(?:^|\/)register-document\.ts$|(?:identity|keys?|secrets?)[^/]*rotat)/iu.test(
      file.path
    ) &&
    /\bverificationMethod\s*[:=]|\b(?:writeFile|writeFileString|generateKeyPair|generateKey|putSecret|setSecret)\s*\(/u.test(
      added
    )
  ) {
    add("key-rotation", "key write or verificationMethod replacement added");
  }

  return findings;
};

export const classifyOneWay = (diff: readonly FileDiff[]): Classification => {
  const findings: Finding[] = [];
  const info: Information[] = [];

  for (const file of diff) {
    const lexicon = lexiconClassification(file);
    const content = [...contentFindings(file), ...(lexicon?.findings ?? [])];
    findings.push(...content);
    info.push(...(lexicon?.info ?? []));

    if (content.length === 0 && lexicon === null && fallbackPath(file.path)) {
      findings.push({
        detail: "unclassified contract or storage path changed",
        kind: "path",
        path: file.path,
      });
    }
  }

  return { findings, info };
};

export const oneWayAnswer = (
  aggregate: Classification,
  commits: readonly CommitClassification[],
  mergeTrailer: string
): OneWayAnswer => {
  const findings = [
    ...aggregate.findings,
    ...commits.flatMap((commit) => commit.findings),
  ];

  const unique = [
    ...new Map(
      findings.map((finding) => [JSON.stringify(finding), finding])
    ).values(),
  ];

  if (unique.length === 0) {
    return Answer.TwoWay();
  }

  const carriers = commits.filter((commit) => commit.findings.length > 0);

  const covered = aggregate.findings.every((finding) =>
    commits.some((commit) =>
      commit.findings.some(
        (candidate) =>
          candidate.path === finding.path && candidate.kind === finding.kind
      )
    )
  );

  return Answer.OneWay({
    findings: unique,
    info: aggregate.info,
    staged:
      mergeTrailer.trim().length > 0 ||
      (covered &&
        carriers.length > 0 &&
        carriers.every((commit) => commit.trailer.trim().length > 0)),
  });
};

export const oneWayExitCode = (answer: OneWayAnswer) =>
  Predicate.isTagged(answer, "OneWay") && !answer.staged ? 4 : 0;
