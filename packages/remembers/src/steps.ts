import type { SliceKeyValue } from "./contract.ts";

export const observerStep = (
  key: SliceKeyValue,
  prompt: string,
  writes: string
) =>
  ({
    agent: { model: "gpt-6.1-sol", thinking: "low" },
    ephemeral: {
      capability: "remembers-slice",
      input: {
        conversation: key.conversation,
        first: key.first_chunk,
        last: key.last_chunk,
      },
    },
    kind: "think",
    post: { capability: "remembers-observed" },
    prompt,
    writes,
  }) as const;

export const judgeStep = (
  observedDoc: string,
  prompt: string,
  writes: string
) =>
  ({
    agent: { model: "gpt-6-astra" },
    ephemeral: { capability: "remembers-judge-input", reads: [observedDoc] },
    kind: "think",
    post: { capability: "remembers-judged" },
    prompt,
    writes,
  }) as const;
