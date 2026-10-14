import type { SessionFacts } from "@rat-king/ratking-client/identity";
import { AgentName } from "@rat-king/ratking-client/name";
import { ReaderState } from "@rat-king/ratking-client/ratking";
import type { LeaseHolder } from "@rat-king/ratking-client/ratking";
import { Option, Schema } from "effect";

export const NAME_ENTRY = "ratking.name";

export const NameSource = Schema.Literals(["default", "env", "restored"]);

export type NameSourceValue = typeof NameSource.Type;

export const NameEntry = Schema.Struct({
  name: AgentName,
  source: NameSource,
});

export type NameEntryValue = typeof NameEntry.Type;

export interface NameChoice {
  readonly name: Option.Option<string>;
  readonly source: NameSourceValue;
}

export interface NamedFacts extends SessionFacts {
  readonly source?: NameSourceValue;
}

export interface ChooseInput {
  readonly env: Option.Option<string>;
  readonly entries: readonly NameEntryValue[];
}

export const parseNameEntries = (
  entries: readonly unknown[]
): readonly NameEntryValue[] =>
  entries.flatMap((entry) => {
    const custom = Schema.decodeUnknownOption(
      Schema.Struct({
        customType: Schema.Literal(NAME_ENTRY),
        data: NameEntry,
        type: Schema.Literal("custom"),
      })
    )(entry);

    return Option.isSome(custom) ? [custom.value.data] : [];
  });

export const chooseName = (input: ChooseInput): NameChoice => {
  if (Option.isSome(input.env)) {
    return { name: input.env, source: "env" };
  }

  const restorable = input.entries.findLast(
    (entry) => entry.source !== "default"
  );

  return restorable === undefined
    ? { name: Option.none(), source: "default" }
    : { name: Option.some(restorable.name), source: "restored" };
};

export const shouldRecord = (
  last: NameEntryValue | undefined,
  next: NameEntryValue
) =>
  last === undefined ||
  last.name !== next.name ||
  (last.source === "default" && next.source !== "default");

export const stateName = (reader: ReaderState): Option.Option<string> =>
  ReaderState.$match(reader, {
    Acquiring: ({ name }) => Option.some(name),
    Live: ({ name }) => Option.some(name),
    Minting: ({ name }) => Option.some(name),
    Refused: ({ name }) => Option.some(name),
    Retrying: ({ name }) => name,
    SendOnly: ({ name }) => Option.some(name),
    Starting: () => Option.none(),
  });

export const heldElsewhere = (
  holder: Option.Option<LeaseHolder>,
  session: string
) => Option.exists(holder, (held) => held.live && held.session !== session);

export const heldReason = (name: string) =>
  `name ${name} is held by another live Pi; not reading`;

export const heldNotice = (name: string) => `🐀 ${heldReason(name)}`;
