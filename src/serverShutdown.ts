import { sq } from './incusCli';

/** Linux /proc identities keep a reused PID from becoming a cleanup target. */
export function shutdownScript(directory: string): string {
  return `server_dir=${sq(directory)}
command -v readlink >/dev/null || { echo 'Server cleanup requires readlink' >&2; exit 1; }
test -r /proc/self/stat || { echo 'Server cleanup requires readable /proc' >&2; exit 1; }
server_dir=$(readlink -f -- "$server_dir") || { echo 'Cannot resolve server installation; installation preserved' >&2; exit 1; }
selected=' '
# stat fields after the final ')' start with state, parent PID, ... start time.
inspect() {
  test -r "$1/stat" || return 1
  IFS= read -r stat_line < "$1/stat" || return 1
  stat_tail=\${stat_line##*) }
  set -- $stat_tail
  state=$1
  parent=$2
  shift 19
  started=$1
  test "$state" != Z && test "$state" != X
}
select_processes() {
  changed=yes
  while test "$changed" = yes; do
    changed=no
    for proc in /proc/[0-9]*; do
      pid=\${proc##*/}
      inspect "$proc" || continue
      case "$selected" in *" $pid:$started "*) continue;; esac
      executable=$(readlink "$proc/exe" 2>/dev/null) || executable=''
      case "$executable" in
        "$server_dir"/*) ;;
        *)
          case "$selected" in *" $parent:"*) ;;
            *) continue;;
          esac
          # Only follow a parent whose recorded process identity still exists.
          child_started=$started
          child_parent=$parent
          inspect "/proc/$child_parent" || continue
          case "$selected" in *" $child_parent:$started "*) ;; *) continue;; esac
          started=$child_started
          ;;
      esac
      selected="$selected$pid:$started "
      changed=yes
    done
  done
}
alive() {
  saved_pid=\${1%%:*}
  saved_start=\${1#*:}
  inspect "/proc/$saved_pid" && test "$started" = "$saved_start"
}
signal_selected() {
  for entry in $selected; do
    if alive "$entry"; then
      kill -"$1" "$saved_pid" 2>/dev/null || {
        if alive "$entry"; then
          echo "Cannot stop server process $saved_pid; installation preserved" >&2
          exit 1
        fi
      }
    fi
  done
}
select_processes
signal_selected TERM
attempt=0
while :; do
  # Include children created during shutdown, and executables already unlinked.
  select_processes
  remaining=no
  for entry in $selected; do
    if alive "$entry"; then remaining=yes; break; fi
  done
  test "$remaining" = yes || break
  attempt=$((attempt + 1))
  if test "$attempt" -ge 30; then
    echo 'Server processes did not exit; installation preserved' >&2
    exit 1
  fi
  if test "$attempt" -ge 10; then signal_selected KILL; else signal_selected TERM; fi
  sleep 0.1
done
`;
}
