import { Hash, Option, Schema } from "effect";

import { AgentName, labelSlug } from "./name.ts";

export const ForkParent = Schema.Struct({
  name: AgentName,
  session: Schema.String.check(Schema.isMinLength(1)),
});

export interface ForkIdentity {
  readonly parent: typeof ForkParent.Type;
  readonly label: string;
}

const sessionHash = (session: string) =>
  Math.abs(Hash.string(session)).toString(16).padStart(8, "0");

export const forkName = (
  fork: ForkIdentity,
  session: string,
  taken: (name: string) => boolean = () => false
): string => {
  const [project = "agent", row] = fork.parent.name.split("/");

  const namespaced =
    row !== undefined || /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(project);

  const namespace = namespaced ? `${project}/` : "";
  const base = row ?? (namespaced ? "" : project);
  const prefix = base === "" ? "" : `${base.slice(0, 25)}-`;

  const label = Option.getOrElse(
    labelSlug(fork.label),
    () =>
      `fork-${
        session
          .toLowerCase()
          .replaceAll(/[^a-z0-9]/gu, "")
          .slice(0, 6) || sessionHash(session).slice(-6)
      }`
  );

  const segment = `${prefix}${label.slice(0, 32 - prefix.length).replace(/-+$/u, "")}`;
  const name = `${namespace}${segment}`;

  return taken(name)
    ? `${namespace}${segment.slice(0, 27).replace(/-+$/u, "")}-${sessionHash(session).slice(-4)}`
    : name;
};
