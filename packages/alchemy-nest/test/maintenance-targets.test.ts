import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { renderMaintenanceScript, renderUnits } from "../src/index.ts";
import { instanceLayout } from "../src/instance.ts";
import { localExec } from "../src/local-exec.ts";
import {
  assertMaintenanceIsolation,
  MaintenanceRenderError,
} from "../src/maintenance-targets.ts";
import { storageMaintenanceScript } from "../src/storage-maintenance-script.ts";

const host = {
  dataRoot: "/srv/example/mailbox",
  home: "/home/example",
  ssh: "example",
  tailnetIPv4: "203.0.113.10",
};

it.prop(
  "named script and unit rendering refuse mailbox ports while default script bytes stay identical",
  {
    port: Arbitrary.schema(Schema.Literals([18_888, 19_333])),
    prefix: Arbitrary.schema(Schema.String),
  },
  ({ port, prefix }) => {
    const props = {
      dataRoot: "/srv/example/mischief",
      instance: "mischief",
      portBase: 28_010,
    };

    const layout = instanceLayout(host, props);

    expect(() => {
      assertMaintenanceIsolation(layout, `${prefix}\nhttp://127.0.0.1:${port}`);
    }).toThrow(MaintenanceRenderError);
    expect(() =>
      renderUnits(host, props, { celld: { memoryMax: `${port}M` } })
    ).toThrow(MaintenanceRenderError);
    expect(() => renderUnits(host, { ...props, portBase: port - 2 })).toThrow(
      MaintenanceRenderError
    );
    expect(() =>
      renderMaintenanceScript(host, { ...props, portBase: port - 2 })
    ).toThrow(MaintenanceRenderError);
    expect(renderMaintenanceScript(host).text).toBe(storageMaintenanceScript);

    const named = renderMaintenanceScript(host, props);

    expect(named.text).not.toContain("18888");
    expect(named.text).not.toContain("19333");
    expect(named.text).not.toContain("http://127.0.0.1:");
  }
);

const fixture = String.raw`
import contextlib, io, json, sys, urllib.error, urllib.parse, urllib.request
script = sys.argv[1]
base = int(sys.argv[2])
root = '/topics/.system/log'
calls = []
expected = {}
class Reply:
    def __init__(self, value): self.body = json.dumps(value).encode()
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, limit): return self.body
class Store:
    def open(self, request, **kwargs):
        url = request.full_url
        calls.append(url)
        if urllib.parse.urlsplit(url).path == root + '/':
            assert url.startswith(expected['filer'] + root + '/?'), url
            raise urllib.error.HTTPError(url, 404, 'missing root', {}, None)
        assert url == expected['master'] + '/dir/status', url
        return Reply({'Topology': {'Free': 16, 'Max': 64, 'Layouts': [{'collection': '', 'replication': '000', 'ttl': '', 'writables': [1]}]}})
urllib.request.build_opener = lambda *args: Store()
def run(action, instance, master, filer, missing=None):
    global expected
    calls.clear()
    expected = {'master': master, 'filer': filer}
    flags = {'--instance': instance, '--master': master, '--filer': filer, '--root': root}
    flags.pop(missing, None)
    sys.argv = ['maintenance', action] + [part for pair in flags.items() for part in pair]
    stdout, stderr = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            exec(script, {'__name__': '__main__'})
        except SystemExit as result:
            return result.code, stdout.getvalue()
    raise AssertionError('script did not exit')
master, filer = 'http://127.0.0.1:' + str(base + 4), 'http://127.0.0.1:' + str(base + 2)
for action in ('retain', 'diagnose'):
    code, output = run(action, 'mischief', master, filer)
    assert code == 0, output
    assert json.loads(output.splitlines()[-1])['alarm'] is False
    assert len(calls) == (2 if action == 'retain' else 1)
for missing in ('--instance', '--master', '--filer', '--root'):
    code, _ = run('retain', 'mischief', master, filer, missing)
    assert code != 0 and not calls
for port in (18081, 18333, 18787, 18788, 18888, 19333, 28081, 28333, 28888, 29333):
    default = 'http://127.0.0.1:' + str(port)
    for use_master in (False, True):
        code, output = run('retain', 'mischief', default if use_master else master, filer if use_master else default)
        assert code != 0 and not calls, output
code, output = run('retain', 'rat-king', 'http://127.0.0.1:19333', 'http://127.0.0.1:18888')
assert code == 0 and len(calls) == 2, output
print('NAMED_TARGETS_DRIVE_REQUESTS_AND_REFUSE_DEFAULT_PORTS')
`;

it.effect.prop(
  "named maintenance requires every target flag and refuses all mailbox ports unless explicitly rat-king",
  {
    base: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 30_100, minimum: 30_010 }))
    ),
  },
  ({ base }) =>
    Effect.gen(function* targets() {
      const executor = yield* localExec;

      const script = renderMaintenanceScript(host, {
        dataRoot: "/srv/example/mischief",
        instance: "mischief",
        portBase: base,
      });

      const result = yield* executor.exec([
        "python3",
        "-c",
        fixture,
        script.text,
        String(base),
      ]);

      expect(result.code, result.stdout).toBe(0);
      expect(result.stdout.trim()).toBe(
        "NAMED_TARGETS_DRIVE_REQUESTS_AND_REFUSE_DEFAULT_PORTS"
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 8 } }
);
