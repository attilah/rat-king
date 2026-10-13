export interface PromptInput {
  readonly accepted: string;
  readonly debug: string;
  readonly fix: string;
  readonly tag: string;
  readonly why: string;
}

export const literalPrompt = (input: PromptInput) =>
  [
    `${input.tag}: ${input.why}`,
    `Accepted: ${input.accepted}`,
    `Fix: ${input.fix}`,
    `Debug: ${input.debug}`,
  ].join("\n");
