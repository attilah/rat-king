import { Console, Effect } from "effect";

import { faulted, promptText } from "./faults.ts";
import type { Fault, Ground } from "./faults.ts";

export interface Report {
  readonly document: object;
  readonly lines: readonly string[];
}

export const withField = <B extends object, K extends string, V>(
  base: B,
  key: K,
  value: V | undefined
): B & Partial<Record<K, V>> => {
  const out: B & Partial<Record<K, V>> = { ...base };

  if (value !== undefined) {
    Object.assign(out, { [key]: value });
  }

  return out;
};

export const emit = (json: boolean, command: string, report: Report) =>
  Console.log(
    json
      ? JSON.stringify({ command, ok: true, ...report.document })
      : report.lines.join("\n")
  );

export const refuse = Effect.fn("RatkingCli.refuse")(function* refuse(
  json: boolean,
  command: string,
  ground: Ground,
  fault: Fault
) {
  const { code, prompt } = faulted(fault, ground);

  yield* json
    ? Console.log(JSON.stringify({ command, error: prompt, ok: false }))
    : Console.error(promptText(prompt));

  yield* Effect.sync(() => {
    process.exitCode = code;
  });
});
