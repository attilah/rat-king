import { writeFileSync } from "node:fs";

import { frames } from "./frames.ts";

writeFileSync(
  new URL("../skills/ratking-tui/references/primitives.md", import.meta.url),
  frames()
);
