#!/usr/bin/env bash
# de-enshittify-discord: install, check or remove the patch on the Windows Discord client, from WSL.
#
#   ./install.sh            install, or re-apply after a Discord update (idempotent)
#   ./install.sh status     which startup files are hooked, and the last status the client reported
#   ./install.sh check      test the patches against Discord's current web build (no changes made)
#   ./install.sh uninstall  remove the hooks and the installed files
#
# Changes take effect the next time Discord starts: quit it from the tray icon, then start it again.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
winenv() { wslpath "$(cd /mnt/c && cmd.exe /d /c "echo %$1%" | tr -d '\r')"; }
appdata=$(winenv APPDATA)
discord="$(winenv LOCALAPPDATA)/Discord"
dest="$appdata/de-enshittify-discord"
marker='// de-enshittify-discord-hook'
hook='try{require(require("path").join(process.env.APPDATA,"de-enshittify-discord","loader.js"))}catch(e){console.error("[de-enshittify-discord] hook failed:",e)} '"$marker"

# Startup files the hook goes into, in every installed Discord version:
#  - resources/app/index.js exists when another client mod (BetterDiscord) has redirected the app;
#    it survives Discord's module updates;
#  - discord_desktop_core/index.js always exists and works without any other mod.
# loader.js ignores a second hook, so being in both is fine.
targets() {
  local f
  for f in "$discord"/app-*/resources/app/index.js \
           "$discord"/app-*/modules/discord_desktop_core-*/discord_desktop_core/index.js; do
    [[ -f $f ]] && printf '%s\n' "$f"
  done
}

hooked() { grep -qF -- "$marker" "$1"; }

cmd=${1:-install}
case $cmd in
  install)
    [[ -d $discord ]] || { echo "Discord isn't installed at $discord" >&2; exit 1; }
    mkdir -p "$dest"
    cp "$here"/src/loader.js "$here"/src/preload.js "$here"/src/renderer.js "$dest"/
    echo "files -> $dest"
    while IFS= read -r f; do
      if hooked "$f"; then
        echo "already hooked: $f"
      else
        { printf '%s\n' "$hook"; cat "$f"; } > "$f.de-enshittify-tmp"
        mv "$f.de-enshittify-tmp" "$f"
        echo "hooked: $f"
      fi
    done < <(targets)
    echo "Restart Discord (tray icon > Quit Discord, then start it) to load the patch."
    ;;
  uninstall)
    while IFS= read -r f; do
      if hooked "$f"; then
        grep -vF -- "$marker" "$f" > "$f.de-enshittify-tmp" || true
        mv "$f.de-enshittify-tmp" "$f"
        echo "unhooked: $f"
      fi
    done < <(targets)
    rm -f "$dest"/loader.js "$dest"/preload.js "$dest"/renderer.js "$dest"/status.json
    rmdir "$dest" 2>/dev/null || true
    echo "Removed. Restart Discord to unload it."
    ;;
  status)
    while IFS= read -r f; do
      if hooked "$f"; then echo "hooked:     $f"; else echo "not hooked: $f"; fi
    done < <(targets)
    for n in loader.js preload.js renderer.js; do
      if [[ ! -f $dest/$n ]]; then echo "missing:    $dest/$n"
      elif ! cmp -s "$here/src/$n" "$dest/$n"; then echo "outdated:   $dest/$n (run ./install.sh)"
      fi
    done
    if [[ -f $dest/status.json ]]; then
      echo "last report from the client ($dest/status.json):"
      cat "$dest/status.json"; echo
    else
      echo "no report from the client yet (it writes one about 20s after Discord starts)"
    fi
    ;;
  check)
    exec node "$here/test/check.mjs"
    ;;
  *)
    echo "usage: $0 [install|status|check|uninstall]" >&2
    exit 2
    ;;
esac
