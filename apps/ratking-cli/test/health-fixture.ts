import type { HealthFacts } from "@rat-king/mailbox-client/health";

export const healthNow = 1_791_676_981_000;

export const healthFixture: HealthFacts = {
  complete: true,
  lastAck: healthNow - 240_000,
  lease: {
    expiresAt: healthNow + 60_000,
    generation: 7,
    holder: "fixture-session",
    pane: "fixture-pane",
  },
  oldestWake: {
    at: healthNow - 181_000,
    id: "3m7x2ka4xv22a",
    sender: "sample/desk",
  },
  quietUnacked: 4,
  reader: "running",
};
