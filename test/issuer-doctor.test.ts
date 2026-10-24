import { describe, expect, it } from "vitest";

import type { AlarmFacts } from "../../../stacks/nest/alarm-sources.ts";
import {
  emptySources,
  observeAlarms,
} from "../../../stacks/nest/alarm-sources.ts";

const now = 1_000_000;

const facts = (
  doctor: boolean,
  doctorReasons: readonly string[]
): typeof AlarmFacts.Type => ({
  cacheBreaches: null,
  deploy: null,
  deployKnown: true,
  digest: "ok",
  doctor,
  doctorReasons,
  entered: now,
  health: 200,
  measurementFailed: false,
  quarantinedHour: 0,
  readers: null,
  receipts: [],
  receiptsKnown: true,
  slots: { free: 50, max: 100 },
});

const REASON =
  "secondary: service issuer host identity is unavailable or malformed";

describe("issuer.broken", () => {
  it("one failed doctor run is not a page; the second in a row fires and names the failing check", () => {
    const first = observeAlarms(emptySources, facts(false, [REASON]), now);

    expect(first.readings["issuer.broken"].status).toBe("unknown");

    const second = observeAlarms(first.sources, facts(false, [REASON]), now);
    const reading = second.readings["issuer.broken"];

    expect(reading.status).toBe("firing");

    if (reading.status === "firing") {
      expect(reading.severity).toBe("critical");
      expect(reading.evidence).toContain(REASON);
    }
  });

  it("a passing run in between resets the count", () => {
    const first = observeAlarms(emptySources, facts(false, [REASON]), now);
    const passed = observeAlarms(first.sources, facts(true, []), now);
    const again = observeAlarms(passed.sources, facts(false, [REASON]), now);

    expect(passed.readings["issuer.broken"].status).toBe("ok");
    expect(again.readings["issuer.broken"].status).toBe("unknown");
  });

  it("a doctor that never reported still fires on the second miss, saying so", () => {
    const missing = "config doctor did not finish within 30 seconds";
    const first = observeAlarms(emptySources, facts(false, [missing]), now);
    const second = observeAlarms(first.sources, facts(false, [missing]), now);
    const reading = second.readings["issuer.broken"];

    expect(reading.status).toBe("firing");

    if (reading.status === "firing") {
      expect(reading.evidence).toContain(missing);
    }
  });
});
