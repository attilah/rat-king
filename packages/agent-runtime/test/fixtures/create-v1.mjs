import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import manifest from "@earendil-works/pi-durable/package.json" with { type: "json" };
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

if (manifest.version !== "1.0.2") {
  throw new Error("Fixture generation requires pi-durable 1.0.2");
}

const storage = await openNodeSqliteStorage(process.argv[2]);

const models = createModels();

const faux = fauxProvider({ api: "faux" });

faux.setResponses([fauxAssistantMessage("v1 journal answer")]);

models.setProvider(faux.provider);

const harness = await Harness.open(
  storage,
  { models, registry: createRegistry() },
  context
);

const root = await harness.root(context, {
  agent: { model: { modelId: "faux-1", provider: "faux" } },
});

const submission = await root.submit(
  { content: "v1 journal question", requestId: "v1-fixture", type: "input" },
  context
);

console.log(JSON.stringify(await submission.wait(context)));

console.log(
  JSON.stringify(
    await storage.scanEntries(
      { conversationId: root.id },
      100,
      undefined,
      context
    )
  )
);

await harness.close(context);
