#!/bin/sh
# One collection. Schedule externally; do not overwrite last good data on failure.
set -eu
if [ "$#" -ne 1 ]; then
  echo 'usage: observation-work-export.sh /absolute/textfile-directory/observation.prom' >&2
  exit 1
fi
case "$1" in /*.prom) ;; *) echo 'absolute .prom output path required' >&2; exit 1 ;; esac
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
status_binary=${TG_OBSERVATION_STATUS_BINARY:-"$script_dir/../bin/observation-work-status"}
case "$status_binary" in /*) ;; *) echo 'absolute status binary required' >&2; exit 1 ;; esac
output_path=$1
temporary_path=$(mktemp "${output_path}.XXXXXX")
trap 'rm -f "$temporary_path"' EXIT HUP INT TERM
status=0
"$status_binary" --once --prometheus > "$temporary_path" || status=$?
case "$status" in
  0|2)
    chmod 644 "$temporary_path"
    mv -f -- "$temporary_path" "$output_path"
    ;;
  *) exit "$status" ;;
esac
exit "$status"
