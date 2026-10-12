import type { InstanceLayout } from "./instance.ts";
import { maintenanceArguments } from "./maintenance-targets.ts";
import type { UnitProps } from "./systemd.ts";

const quote = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$")}"`;

export const storageRetentionUnit = (
  home: string,
  script: string,
  ready: readonly string[],
  layout?: InstanceLayout
): UnitProps => ({
  enabled: false,
  home,
  name: layout?.retentionUnit ?? "rat-king-storage-retention.service",
  restartOn: ready,
  scope: "user",
  sections: [
    {
      lines: [
        [
          "Description",
          layout === undefined || layout.instance === "rat-king"
            ? "Rat King filer metadata log retention and storage alarm"
            : `${layout.instance} filer metadata log retention and storage alarm`,
        ],
        ["Requires", layout?.storeUnit ?? "rat-king-seaweedfs.service"],
        ["After", layout?.storeUnit ?? "rat-king-seaweedfs.service"],
        ...(layout === undefined || layout.instance === "rat-king"
          ? [["StartLimitIntervalSec", "0"] satisfies readonly [string, string]]
          : []),
      ],
      name: "Unit",
    },
    {
      lines: [
        ["Type", "oneshot"],
        [
          "ExecStart",
          `/usr/bin/python3 ${quote(script)} retain${maintenanceArguments(layout)}`,
        ],
        ["Slice", layout?.slice ?? "rat-king.slice"],
        ["MemoryMax", "128M"],
        ["MemorySwapMax", "0"],
        ["CPUQuota", "10%"],
        ["TasksMax", "32"],
        ["Nice", "10"],
        ["UMask", "0077"],
        ["TimeoutStartSec", "10min"],
        [
          "Restart",
          layout === undefined || layout.instance === "rat-king"
            ? "on-failure"
            : "no",
        ],
        ...(layout === undefined || layout.instance === "rat-king"
          ? [["RestartSec", "60"] satisfies readonly [string, string]]
          : []),
      ],
      name: "Service",
    },
  ],
  started: false,
});

export const storageRetentionTimer = (
  home: string,
  ready: readonly string[],
  layout?: InstanceLayout
): UnitProps => ({
  home,
  name: layout?.retentionTimer ?? "rat-king-storage-retention.timer",
  restartOn: ready,
  scope: "user",
  sections: [
    {
      lines: [
        [
          "Description",
          layout === undefined || layout.instance === "rat-king"
            ? "Rat King hourly filer log retention"
            : `${layout.instance} hourly filer log retention`,
        ],
      ],
      name: "Unit",
    },
    {
      lines: [
        ["OnCalendar", "*-*-* *:15:00 UTC"],
        ["Persistent", "true"],
        ["Unit", layout?.retentionUnit ?? "rat-king-storage-retention.service"],
      ],
      name: "Timer",
    },
    { lines: [["WantedBy", "default.target"]], name: "Install" },
  ],
});
