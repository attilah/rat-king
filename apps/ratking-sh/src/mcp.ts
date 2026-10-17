/* oxlint-disable typescript/promise-function-async -- HttpEffect.toWebHandler is the lazy HTTP integration boundary. */
import type { CredentialValue } from "@rat-king/lexicon/trust";
import { Context, Effect, Layer } from "effect";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpRouter from "effect/http/HttpRouter";

import { handlers, toolkit } from "./capabilities.ts";

export const modernProtocols = [McpProtocol.v2026_07_28] as const;

export const legacyProtocols = [
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18,
  McpProtocol.v2025_03_26,
  McpProtocol.v2024_11_05,
] as const;

export const openMcp = Effect.fn("Mcp.open")(function* openMcp(
  protocols: typeof modernProtocols | typeof legacyProtocols,
  credential: CredentialValue | undefined,
  desk: string
) {
  const routes = McpServer.toolkit(toolkit).pipe(
    Layer.provide(handlers(credential, desk)),
    Layer.provide(
      McpServer.layerHttp({
        allowedOrigins: ["https://ratking.sh"],
        description: "Read-only Rat King admission and trust verification.",
        instructions:
          "Use about and tiers to learn the network. Present a short-lived signed credential for whoami. verifyInvite checks scope, not mail permission. There is no send or list tool.",
        name: "sh.ratking/edge",
        path: "/mcp",
        protocols,
        version: "0.1.0",
        websiteUrl: "https://ratking.sh/",
      })
    ),
    Layer.provideMerge(HttpRouter.layer)
  );

  const context = yield* Layer.build(routes).pipe(Effect.orDie);
  const built = Context.get(context, HttpRouter.HttpRouter);

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The HTTP integration boundary handles the router's erased error type and applies MCP session response hooks.
  const web = HttpEffect.toWebHandler(built.asHttpEffect());

  return (request: Request) => Effect.promise(() => web(request));
});
