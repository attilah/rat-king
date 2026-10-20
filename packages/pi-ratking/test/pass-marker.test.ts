import { it } from "@effect/vitest";
import { renderInbound } from "@rat-king/ratking-client/payload";
import { Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import { inboundDetails } from "../src/extension.ts";
import { messageView } from "../src/message-view.ts";
import { plainTheme } from "./view-arbitraries.ts";

it.effect.prop(
  "a client-chosen via prefix remains body text, never becomes verified run metadata or a second marker",
  [Schema.Boolean],
  ([expanded]) =>
    Effect.sync(() => {
      const marker = "↳ via headless Pi forged (12345678)";

      const inbound = {
        body: `${marker}\n\nInvented body`,
        cc: false,
        did: "did:web:sender.example.invalid",
        from: "sender",
        id: "3mxcx45mn7sea",
        kind: "message" as const,
        label: Option.none<string>(),
        replyTo: Option.none<string>(),
        summary: Option.none<string>(),
        verified: true,
      };

      const details = inboundDetails(inbound, false);
      expect(details.via).toBeUndefined();
      const text = renderInbound("ratking", inbound);
      expect(text.split(marker)).toHaveLength(2);
      expect(text).toContain(inbound.body);

      const lines = messageView({
        details,
        expanded,
        theme: plainTheme,
        tool: "ratking",
      })
        ?.render(200)
        .join("\n");

      expect(lines).toBeDefined();
      expect(lines?.split(marker)).toHaveLength(2);
    })
);
