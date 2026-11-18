#!/usr/bin/env bash
# de-enshittify discord: development helper for working on the patch from WSL.
# (Users install with the PowerShell one-liner in the README; this runs the same install.ps1, but
# with the files from this checkout instead of downloading them.)
#
#   ./install.sh            install this checkout's src/ (or re-apply after a Discord update)
#   ./install.sh status     which startup files are hooked, and the last status the client reported
#   ./install.sh check      test the patches against Discord's current web build (no changes made)
#   ./install.sh uninstall  remove the hooks and the installed files
#
# install and uninstall restart Discord if it's running, so the change takes effect (this drops you
# from any voice call). Add --no-restart to skip that and restart it yourself later.
set -euo pipefail

restart=1
args=()
for a in "$@"; do
  case $a in
    --no-restart) restart=0 ;;
    *) args+=("$a") ;;
  esac
done

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
winenv() { wslpath "$(cd /mnt/c && cmd.exe /d /c "echo %$1%" | tr -d '\r')"; }
appdata=$(winenv APPDATA)
discord="$(winenv LOCALAPPDATA)/Discord"
dest="$appdata/de-enshittify-discord"
marker='// de-enshittify-discord-hook'

# Runs install.ps1 from this checkout, installing src/ from here rather than from GitHub.
installer() {
  local opts=(-NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$here/install.ps1")" -Source "$(wslpath -w "$here/src")")
  [[ $restart == 0 ]] && opts+=(-NoRestart)
  (cd /mnt/c && powershell.exe "${opts[@]}" "$@") | tr -d '\r'
}

# The startup files install.ps1 hooks, for status (Discord stable only).
targets() {
  local f
  for f in "$discord"/app-*/resources/app/index.js \
           "$discord"/app-*/modules/discord_desktop_core-*/discord_desktop_core/index.js; do
    [[ -f $f ]] && printf '%s\n' "$f"
  done
}

cmd=${args[0]:-install}
case $cmd in
  install)
    installer
    ;;
  uninstall)
    installer -Uninstall
    ;;
  status)
    while IFS= read -r f; do
      kind=""
      grep -qF -- '// de-enshittify-discord-redirect' "$f" && kind=" (redirect made by heal.js)"
      if grep -qF -- "$marker" "$f"; then echo "hooked:     $f$kind"; else echo "not hooked: $f"; fi
    done < <(targets)
    for n in loader.js preload.js renderer.js heal.js; do
      if [[ ! -f $dest/$n ]]; then echo "missing:    $dest/$n"
      elif ! cmp -s "$here/src/$n" "$dest/$n"; then echo "differs:    $dest/$n (from this checkout's src/)"
      fi
    done
    if [[ -f $dest/status.json ]]; then
      echo "last report from the client ($dest/status.json):"
      cat "$dest/status.json"; echo
    else
      echo "no report from the client yet (it writes one about 20s after Discord starts)"
    fi
    if [[ -f $dest/heal.log ]]; then
      echo "self-healing log ($dest/heal.log, last 10 lines):"
      tail -n 10 "$dest/heal.log"
    fi
    ;;
  check)
    exec node "$here/test/check.mjs"
    ;;
  *)
    echo "usage: $0 [install|status|check|uninstall] [--no-restart]" >&2
    exit 2
    ;;
esac
