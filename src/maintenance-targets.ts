import { Schema } from "effect";

import type { InstanceLayout } from "./instance.ts";

export class MaintenanceRenderError extends Schema.TaggedError<MaintenanceRenderError>()(
  "MaintenanceRenderError",
  { reason: Schema.String }
) {}

const quote = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$")}"`;

export const assertMaintenanceIsolation = (
  layout: InstanceLayout,
  text: string
): void => {
  if (
    layout.instance !== "rat-king" &&
    /(?<!\d)(?:18888|19333)(?!\d)/u.test(text)
  ) {
    throw new MaintenanceRenderError({
      reason: "Named maintenance render contains a mailbox port.",
    });
  }
};

export const maintenanceArguments = (layout?: InstanceLayout): string => {
  if (layout === undefined || layout.instance === "rat-king") {
    return "";
  }

  const argumentsText = ` --instance ${quote(layout.instance)} --master http://127.0.0.1:${layout.ports.master} --filer http://127.0.0.1:${layout.ports.filer} --root /topics/.system/log`;

  assertMaintenanceIsolation(layout, argumentsText);

  return argumentsText;
};
