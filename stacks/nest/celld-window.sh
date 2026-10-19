#!/usr/bin/env bash
set -Eeuo pipefail

celld=rat-king-celld.service
store=rat-king-seaweedfs.service
backup=rat-king-mailbox-backup.service
deadline=rat-king-celld-window-deadline
deadline_after=30min
state_dir=${XDG_STATE_HOME:-$HOME/.local/state}/rat-king
marker=$state_dir/deploy.json
receipts=
proc_root=/proc
reason=
approval=
expect_env=
dry_run=0

usage() {
  printf 'usage: celld-window.sh --reason TEXT --approval REF [--dry-run] [--marker FILE] [--receipts FILE] [--expect-env KEY] -- COMMAND [ARG...]\n' >&2
  exit 64
}

while [ $# -gt 0 ]; do
  case $1 in
    --reason) reason=${2:?}; shift 2 ;;
    --approval) approval=${2:?}; shift 2 ;;
    --marker) marker=${2:?}; shift 2 ;;
    --receipts) receipts=${2:?}; shift 2 ;;
    --expect-env) expect_env=${2:?}; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --) shift; break ;;
    *) usage ;;
  esac
done

[ -n "$receipts" ] || receipts=$(dirname "$marker")/window-receipts.jsonl

[ -n "$reason" ] && [ -n "$approval" ] && [ $# -gt 0 ] || usage

ctl() { systemctl --user "$@"; }
log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
show() { ctl show -p "$1" --value "$2"; }
sight() { printf '%s %s' "$(show MainPID "$celld")" "$(show ActiveEnterTimestamp "$celld")"; }

if [ "$dry_run" = 1 ]; then
  printf 'plan (dry run, nothing touched)\n'
  printf '  reason: %s\n  approval: %s\n  marker: %s\n  receipts: %s\n' "$reason" "$approval" "$marker" "$receipts"
  printf '  1 precheck: %s not activating; %s and %s active; record pid and ActiveEnterTimestamp\n' "$backup" "$celld" "$store"
  printf '  2 backup first: systemctl --user start %s; abort before any stop if it fails\n' "$backup"
  printf '  3 arm: trap EXIT INT TERM ERR starts %s; systemd-run --user --on-active=%s --unit=%s systemctl --user start %s\n' "$celld" "$deadline_after" "$deadline" "$celld"
  printf '  4 marker restarting; systemctl --user stop %s; run:' "$celld"
  printf ' %q' "$@"
  printf '\n'
  printf '  5 systemctl --user start %s; require active with new pid and ActiveEnterTimestamp; marker done; cancel %s.timer\n' "$celld" "$deadline"
  printf '  6 append window receipt to %s\n' "$receipts"
  exit 0
fi

stopped=0
healed=0
began=
before=
before_pid=
before_entered=
work_pid=
result=failed
after_pid=
after_entered=

set_phase() {
  local next
  next=$(mktemp "$marker.XXXXXX")
  jq --arg phase "$1" --argjson now "$(date -u +%s)" \
    'if $phase == "restarting" then .phase = $phase | .started = $now else .phase = $phase end' \
    "$marker" > "$next"
  mv "$next" "$marker"
}

sighting_json() {
  jq -cn --arg entered "$2" --argjson pid "$1" '{entered: $entered, pid: $pid}'
}

write_receipt() {
  local after=null ended
  ended=$(date -u +%s)
  if [ -n "$after_pid" ]; then
    after=$(sighting_json "$after_pid" "$after_entered")
  fi
  mkdir -p "$(dirname "$receipts")"
  jq -cn --arg approval "$approval" --arg reason "$reason" --arg result "$result" \
    --argjson after "$after" --argjson before "$before" \
    --argjson end "$ended" --argjson start "$began" \
    '{approval: $approval, celldAfter: $after, celldBefore: $before, end: $end, kind: "window", reason: $reason, result: $result, start: $start}' \
    >> "$receipts"
}

heal() {
  if [ "$stopped" = 1 ] && [ "$healed" = 0 ]; then
    healed=1
    trap - EXIT INT TERM ERR
    if [ -n "$work_pid" ]; then
      kill "$work_pid" 2> /dev/null || true
    fi
    log "healing: starting $celld through systemd"
    ctl start "$celld" || true
    ctl stop "$deadline.timer" 2> /dev/null || true
    set_phase done || true
    write_receipt || true
  fi
}

on_signal() {
  heal
  exit "$1"
}

log "step1 precheck"
[ "$(ctl is-active "$backup" || true)" != activating ]
[ "$(ctl is-active "$celld")" = active ]
[ "$(ctl is-active "$store")" = active ]
before=$(sighting_json "$(show MainPID "$celld")" "$(show ActiveEnterTimestamp "$celld")")
began=$(date -u +%s)

log "step2 backup with celld running"
if ! ctl start "$backup"; then
  log "backup failed; nothing was stopped"
  exit 1
fi
[ "$(show Result "$backup")" = success ] || { log "backup result not success; nothing was stopped"; exit 1; }
[ "$(ctl is-active "$celld")" = active ] || { log "celld not active after backup; refusing to stop"; exit 1; }

log "step3 arm safety nets"
trap heal EXIT
trap heal ERR
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
ctl stop "$deadline.timer" 2> /dev/null || true
systemd-run --user --on-active="$deadline_after" --unit="$deadline" systemctl --user start "$celld"

log "step4 marker restarting, stop celld, run work"
read -r before_pid before_entered <<< "$(sight)"
set_phase restarting
ctl stop "$celld"
stopped=1
"$@" &
work_pid=$!
wait "$work_pid"
work_pid=

log "step5 start celld through systemd"
ctl start "$celld"
[ "$(ctl is-active "$celld")" = active ]
read -r after_pid after_entered <<< "$(sight)"
[ "$after_pid" != "$before_pid" ] && [ "$after_entered" != "$before_entered" ] || { log "celld pid or ActiveEnterTimestamp did not change"; exit 1; }
if [ -n "$expect_env" ]; then
  tr '\0' '\n' < "$proc_root/$after_pid/environ" | grep -q "^$expect_env=" || { log "expected env key $expect_env missing from celld"; exit 1; }
fi
set_phase done
ctl stop "$deadline.timer" 2> /dev/null || true

log "step6 receipt"
result=success
stopped=0
trap - EXIT INT TERM ERR
write_receipt
log "WINDOW-DONE"
