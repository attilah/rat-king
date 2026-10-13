import { Option } from "effect";

export const digestFor = (
  table: Readonly<Record<string, number>>,
  name: string
): Option.Option<number> =>
  Option.orElse(Option.fromNullishOr(table[name]), () =>
    Option.fromNullishOr(table[name.split("/")[0] ?? name])
  );
