import { instanceLayout } from "./instance.ts";
import type { InstanceProps } from "./instance.ts";
import type { Node } from "./inventory-schema.ts";
import {
  assertMaintenanceIsolation,
  maintenanceArguments,
} from "./maintenance-targets.ts";
import {
  maintenanceImplementation,
  maintenancePrelude,
  legacyMaintenanceScript,
} from "./storage-maintenance-script.ts";

const configuration = String.raw`import argparse

parser = argparse.ArgumentParser()
parser.add_argument("action", choices=("retain", "diagnose", "grow"))
parser.add_argument("--instance", required=True)
parser.add_argument("--master", required=True)
parser.add_argument("--filer", required=True)
parser.add_argument("--root", required=True)
args = parser.parse_args()
mailbox_ports = {18000 + offset for offset in (81, 333, 787, 788, 888, 1333, 10081, 10333, 10888, 11333)}

def target(value):
    try:
        url = urllib.parse.urlsplit(value)
        port = url.port
    except ValueError:
        parser.error("invalid maintenance target")
    if url.scheme != "http" or url.hostname != "127.0.0.1" or url.username is not None or url.password is not None or url.path not in ("", "/") or url.query or url.fragment or port is None or port <= 0:
        parser.error("maintenance target must be an explicit loopback HTTP endpoint")
    if args.instance != "rat-king" and port in mailbox_ports:
        parser.error("named maintenance refuses mailbox ports")
    return value.rstrip("/")

MASTER = target(args.master)
FILER = target(args.filer)
if args.root != "/topics/.system/log":
    parser.error("maintenance root must be the metadata log root")
ROOT = args.root
sys.argv = [sys.argv[0], args.action]
`;

export const renderMaintenanceScript = (
  host: Node,
  props: InstanceProps & { readonly dataRoot?: string } = {}
) => {
  const layout = instanceLayout(host, props);

  const text =
    layout.instance === "rat-king"
      ? legacyMaintenanceScript(layout.ports.master, layout.ports.filer)
      : maintenancePrelude + configuration + maintenanceImplementation;

  maintenanceArguments(layout);
  assertMaintenanceIsolation(layout, text);

  return { path: `${layout.bin}/storage-maintenance.py`, text };
};
