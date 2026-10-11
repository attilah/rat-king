export const goneFixture = String.raw`
import glob, json, os, subprocess, sys, types
world = json.loads(sys.argv[1])
script = sys.argv[2]
before = {'rat-king-celld.service': 111, 'rat-king-seaweedfs.service': 222}
def run(args, **kwargs):
    if world['commands']:
        raise subprocess.CalledProcessError(1, args)
    output = ''
    if 'list-unit-files' in args:
        if 'mischiefrb-*' in args and world['units']:
            output = 'mischiefrb-celld.service enabled'
        if 'mischiefrb.slice' in args and world['slice']:
            output = 'mischiefrb.slice static'
    elif 'list-units' in args:
        output = 'mischiefrb.slice loaded inactive' if world['loaded'] else ''
    elif args[0] == 'ss':
        output = 'LISTEN 0 128 127.0.0.1:28019 0.0.0.0:*' if world['listener'] else ''
    elif 'show' in args:
        unit = args[3]
        pid = before[unit] + int(world['pid'])
        state = 'inactive' if world['inactive'] else 'active'
        output = 'ActiveState=' + state + '\nMainPID=' + str(pid)
    else:
        raise ValueError('Unexpected command')
    return types.SimpleNamespace(stdout=output)
subprocess.run = run
glob.glob = lambda path: ['mischiefrb-leftover'] if world['link'] and '.wants' in path else []
os.path.lexists = lambda path: world['directory'] or (world['socket'] and path.startswith('/tmp/'))
sys.argv = ['probe', '/home/example', '/srv/example/mischiefrb', json.dumps(before)]
exec(script)
`;
