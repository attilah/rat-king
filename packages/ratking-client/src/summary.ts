import { SUMMARY_MAX, SUMMARY_WIRE_MAX } from "./payload.ts";

const WORD_WINDOW = 40;

export interface ClampedSummary {
  readonly full: string;
  readonly note: string;
  readonly summary: string;
}

export const normalizeSummary = (text: string) =>
  text.replaceAll(/\s+/gu, " ").trim();

const cutAt = (text: string, target: number) => {
  const boundary = text.lastIndexOf(" ", target);

  if (boundary > 0 && boundary >= target - WORD_WINDOW) {
    return text.slice(0, boundary).trimEnd();
  }

  const end =
    (text.codePointAt(target - 1) ?? 0) > 0xff_ff ? target - 1 : target;

  return text.slice(0, end);
};

export const clampSummary = (
  original: string,
  wireMax: number = SUMMARY_WIRE_MAX
): ClampedSummary | undefined => {
  const normalized = normalizeSummary(original);

  if (normalized.length <= wireMax) {
    return undefined;
  }

  const summary = `${cutAt(normalized, SUMMARY_MAX - 1)}…`;

  return {
    full: original.trim(),
    note: `summary trimmed to ${summary.length} characters; the full text leads the message.`,
    summary,
  };
};

export const withSummaryLead = (
  lead: string | undefined,
  message: string | undefined
) => {
  if (lead === undefined) {
    return message;
  }

  return message === undefined ? lead : `${lead}\n\n${message}`;
};
