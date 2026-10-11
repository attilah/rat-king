import { visibleWidth } from "@earendil-works/pi-tui";
import { Schema } from "effect";

export const Token = Schema.Literals([
  "word ",
  "lease ",
  "🐀",
  "漢字",
  "\n",
  "\n\n",
  "\t",
  "an-unbreakable-token-that-is-much-wider-than-a-phone-screen-xxxxxxxxxxxxxxxxxxxxxxxx",
  "\u001B[2J",
  "\u001B[31m",
  "\u001B]8;;https://evil.example.invalid\u0007",
  "\u009B2J",
  "\u0007",
  "\u0008",
]);

export const Tokens = Schema.Array(Token).check(Schema.isMaxLength(40));

export const joined = (tokens: readonly string[]) => tokens.join("");

export const maybeJoined = (tokens: readonly string[] | undefined) =>
  tokens === undefined ? undefined : joined(tokens);

export const Width = Schema.Int.check(
  Schema.isBetween({ maximum: 200, minimum: 1 })
);

// oxlint-disable-next-line no-control-regex -- the theme's own SGR forms and truncation's reset.
const THEME_SGR = /\u001B\[(?:0|1|22|39|38;5;\d+)m/gu;

// oxlint-disable-next-line no-control-regex -- finding control characters is the point.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

const COLOURS = new Map<string, number>();

export const ansiTheme = {
  bold: (value: string) => `\u001B[1m${value}\u001B[22m`,
  fg: (colour: string, value: string) => {
    const code = COLOURS.get(colour) ?? COLOURS.size + 1;
    COLOURS.set(colour, code);

    return `\u001B[38;5;${code}m${value}\u001B[39m`;
  },
};

export const plainTheme = {
  bold: (value: string) => value,
  fg: (_colour: string, value: string) => value,
};

export const assertFits = (lines: readonly string[], width: number) => {
  for (const line of lines) {
    if (visibleWidth(line) > width) {
      throw new Error(`line wider than ${width}: ${JSON.stringify(line)}`);
    }

    if (CONTROL.test(line.replaceAll(THEME_SGR, ""))) {
      throw new Error(`unstripped control: ${JSON.stringify(line)}`);
    }
  }
};
