import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { validTuning } from "../src/celld.ts";
import { environmentTemplate } from "../src/store-credentials.ts";

const url = "http://127.0.0.1:1";

it.effect("no tuning renders the environment byte for byte as before", () =>
  Effect.sync(() => {
    expect(environmentTemplate("alpha-cells", url, {})).toBe(
      'AWS_ACCESS_KEY_ID={{ACCESS_KEY}}\nAWS_SECRET_ACCESS_KEY={{SECRET_KEY}}\nAWS_REGION=us-east-1\nS3_ENDPOINT="http://127.0.0.1:1"\nCELLD_BUCKET="s3://alpha-cells"\nCELLD_OTEL=0\n'
    );
  })
);

it.effect("tuning lines follow the fixed lines in key order", () =>
  Effect.sync(() => {
    const lines = environmentTemplate("alpha-cells", url, {
      CELLD_HANDLER_BUDGET_S: "1800",
      CELLD_LTX_LOCAL_L0_KEEP: "1000",
    })
      .trim()
      .split("\n");

    expect(lines.slice(-3)).toEqual([
      "CELLD_OTEL=0",
      'CELLD_HANDLER_BUDGET_S="1800"',
      'CELLD_LTX_LOCAL_L0_KEEP="1000"',
    ]);
  })
);

it.effect("tuning refuses reserved, foreign and unsafe entries", () =>
  Effect.sync(() => {
    expect(validTuning({ CELLD_HANDLER_BUDGET_S: "1800" })).toBe(true);
    expect(validTuning({ CELLD_BUCKET: "s3://other" })).toBe(false);
    expect(validTuning({ CELLD_OTEL: "1" })).toBe(false);
    expect(validTuning({ AWS_REGION: "x" })).toBe(false);
    expect(validTuning({ CELLD_X: "a b" })).toBe(false);
    expect(validTuning({ CELLD_X: "" })).toBe(false);
    expect(validTuning({ CELLD_X: "$(id)" })).toBe(false);
  })
);
