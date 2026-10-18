import { Schema } from "effect";

import { AbsolutePath, textDigest } from "./files.ts";

export const isPlistText = (value: string): boolean =>
  Array.from(value, (character) => character.codePointAt(0) ?? 0).every(
    (point) => point >= 32 && point !== 127
  );

const atom = Schema.String.check(Schema.makeFilter(isPlistText));

export const LaunchdSchema = Schema.Struct({
  deleteOnRemove: Schema.optionalKey(Schema.Boolean),
  directory: AbsolutePath,
  environment: Schema.Record(
    Schema.String.check(Schema.isPattern(/^[A-Z_][A-Z0-9_]*$/u)),
    atom
  ),
  label: Schema.String.check(
    Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9.-]{1,180}$/u)
  ),
  labelPrefix: Schema.String.check(
    Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9.-]{1,160}$/u)
  ),
  programArguments: Schema.NonEmptyArray(atom),
  uid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  workingDirectory: AbsolutePath,
});

export type LaunchdProps = typeof LaunchdSchema.Type;

export const protectedLabels: readonly string[] = ["com.ratking.fleet-ship"];

const reservedPrefixes = ["com.apple", "com.ratking", "homebrew"];

export const allowedLabel = (label: string, prefix: string): boolean =>
  /^[a-zA-Z][a-zA-Z0-9.-]{1,160}$/u.test(prefix) &&
  !reservedPrefixes.some(
    (reserved) => prefix === reserved || prefix.startsWith(`${reserved}.`)
  ) &&
  label.startsWith(`${prefix}.`) &&
  !protectedLabels.includes(label);

const xml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const launchdPath = (props: LaunchdProps): string =>
  `${props.directory}/${props.label}.plist`;

export const launchdTarget = (
  props: Pick<LaunchdProps, "uid" | "label">
): string => `gui/${props.uid}/${props.label}`;

export const renderPlist = (
  props: LaunchdProps
): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(props.label)}</string>
<key>ProgramArguments</key><array>${props.programArguments.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(props.workingDirectory)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(props.environment)
  .toSorted(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`)
  .join("")}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Background</string>
<key>Nice</key><integer>10</integer>
<key>LowPriorityIO</key><true/>
</dict></plist>
`;

export const plistDigest = (props: LaunchdProps): string =>
  textDigest(renderPlist(props));
