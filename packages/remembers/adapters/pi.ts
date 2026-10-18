import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect, Function as Fn } from "effect";
import type { ManagedRuntime } from "effect";
import { Type } from "typebox";
import type { Static } from "typebox";

import type { SliceSource, Store } from "../src/contract.ts";
import { logUse, recallHelp, search } from "../src/recall.ts";

const SearchParams = Type.Object({
  project: Type.Optional(Type.String()),
  text: Type.String(),
});

const UseParams = Type.Object({ id: Type.String(), project: Type.String() });

export const recallExtension =
  <E>(runtime: ManagedRuntime.ManagedRuntime<Store | SliceSource, E>) =>
  (pi: Pick<ExtensionAPI, "registerTool">) => {
    pi.registerTool({
      description: recallHelp,
      execute: Fn.flow(
        (
          _id: string,
          params: Static<typeof SearchParams>,
          signal?: AbortSignal
        ) =>
          [
            search({ project: params.project ?? null, text: params.text }).pipe(
              Effect.map((hits) => ({
                content: [
                  { text: JSON.stringify(hits), type: "text" as const },
                ],
                details: hits,
              }))
            ),
            { signal },
          ] satisfies Parameters<typeof runtime.runPromise>,
        Fn.tupled(runtime.runPromise)
      ),
      label: "Remembers Search",
      name: "remembers",
      parameters: SearchParams,
    });
    pi.registerTool({
      description:
        "Record a memory result you actually acted on. The call ID is an idempotent use identity. Never log every search hit.",
      execute: Fn.flow(
        (
          callId: string,
          params: Static<typeof UseParams>,
          signal?: AbortSignal
        ) =>
          [
            logUse(params.project, params.id, callId).pipe(
              Effect.as({
                content: [{ text: "Use recorded.", type: "text" as const }],
                details: undefined,
              })
            ),
            { signal },
          ] satisfies Parameters<typeof runtime.runPromise>,
        Fn.tupled(runtime.runPromise)
      ),
      label: "Remembers Use",
      name: "remembers_use",
      parameters: UseParams,
    });
  };
