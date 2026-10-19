import { Effect } from "effect";

import { refusal } from "./pass-failure.ts";

const entry =
  /^(?<method>[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+)(?::(?<pattern>[^:*\s]+(?:\/\*)?))?$/u;

const parse = (value: string) => {
  const match = entry.exec(value);

  if (match?.groups === undefined) {
    return null;
  }

  return { method: match.groups.method ?? "", pattern: match.groups.pattern };
};

const covers = (requested: string, granted: string) => {
  const child = parse(requested);
  const parent = parse(granted);

  if (child === null || parent === null || child.method !== parent.method) {
    return false;
  }

  if (parent.pattern === undefined) {
    return true;
  }

  if (child.pattern === undefined) {
    return false;
  }

  return (
    parent.pattern === child.pattern ||
    (parent.pattern.endsWith("/*") &&
      child.pattern.startsWith(parent.pattern.slice(0, -1)))
  );
};

export const scopeWithin = (
  passScope: readonly string[],
  issuerScope: readonly string[]
) =>
  Effect.suspend(() => {
    if (
      passScope.length === 0 ||
      issuerScope.some((scope) => parse(scope) === null) ||
      passScope.some(
        (scope) => !issuerScope.some((grant) => covers(scope, grant))
      )
    ) {
      return Effect.fail(
        refusal(
          "Scope refused",
          "empty, invalid or wider than the issuer scope",
          "request a narrower supported scope"
        )
      );
    }

    return Effect.void;
  });

export const grantableScope = (
  scopes: readonly string[],
  grantable: ReadonlySet<string>
) =>
  scopeWithin(scopes, scopes).pipe(
    Effect.flatMap(() => {
      if (
        scopes.some((scope) => {
          const parsed = parse(scope);

          return parsed === null || !grantable.has(parsed.method);
        })
      ) {
        return Effect.fail(
          refusal(
            "Scope refused",
            "method is not grantable",
            "request a supported worker method"
          )
        );
      }

      return Effect.void;
    })
  );
