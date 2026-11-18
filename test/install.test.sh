#!/usr/bin/env bash
# Tests install.ps1 (install, self-healing, uninstall) against a fake Discord install in Windows'
# temp folder, from WSL. It points LOCALAPPDATA and APPDATA at the fake install and never restarts
# anything (-NoRestart), so the real Discord isn't touched.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
wintemp=$(wslpath "$(cd /mnt/c && cmd.exe /d /c 'echo %TEMP%' | tr -d '\r')")
fixture=$(mktemp -d "$wintemp/de-enshittify-test-XXXXXX")
trap 'rm -rf "$fixture"' EXIT
local_dir="$fixture/Local"
roaming="$fixture/Roaming"
mkdir -p "$roaming"
fails=0

ok() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else fail "$1"; fi; }

ps1() {
  (cd /mnt/c && powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \
    "\$env:LOCALAPPDATA='$(wslpath -w "$local_dir")'; \$env:APPDATA='$(wslpath -w "$roaming")'; & '$(wslpath -w "$here/install.ps1")' -Source '$(wslpath -w "$here/src")' -NoRestart $*") \
    | tr -d '\r' >/dev/null
}

# A Discord version folder; with "bd", BetterDiscord's redirect is in resources/app.
make_version() {
  local app="$local_dir/Discord/app-$1"
  mkdir -p "$app/modules/discord_desktop_core-1/discord_desktop_core" "$app/resources"
  printf "module.exports = require('./core.asar');" > "$app/modules/discord_desktop_core-1/discord_desktop_core/index.js"
  if [[ ${2:-} == bd ]]; then
    mkdir -p "$app/resources/betterdiscord.app.asar" "$app/resources/app"
    printf '\nrequire("../betterdiscord.app.asar");\n' > "$app/resources/app/index.js"
  else
    mkdir -p "$app/resources/app.asar"
    printf '{"name":"discord","main":"bundle.js"}' > "$app/resources/app.asar/package.json"
  fi
}

heal() {
  node -e 'console.log(require(process.argv[1]).heal(process.argv[2], process.argv[3]).length)' \
    "$here/src/heal.js" "$local_dir/Discord" "$1" >/dev/null
}

echo "without another mod:"
make_version 1.0.100
cp -r "$local_dir/Discord" "$fixture/original"
ps1
check "install copies the patch" '[[ -f $roaming/de-enshittify-discord/heal.js && -f $roaming/de-enshittify-discord/loader.js ]]'
check "install hooks the core" 'grep -qF "de-enshittify-discord-hook" "$local_dir/Discord/app-1.0.100/modules/discord_desktop_core-1/discord_desktop_core/index.js"'
heal 1.0.100
check "Discord's first start creates the redirect" 'grep -qF "de-enshittify-discord-redirect" "$local_dir/Discord/app-1.0.100/resources/app/index.js"'
make_version 1.0.101
heal 1.0.100
check "a desktop update gets hooked" 'grep -qF "de-enshittify-discord-hook" "$local_dir/Discord/app-1.0.101/resources/app/index.js"'
ps1 -Uninstall
check "uninstall removes the patch folder" '[[ ! -e $roaming/de-enshittify-discord ]]'
check "uninstall removes the redirects" '[[ ! -e $local_dir/Discord/app-1.0.100/resources/app && ! -e $local_dir/Discord/app-1.0.101/resources/app ]]'
check "uninstall restores the original files exactly" 'diff -r "$fixture/original/app-1.0.100" "$local_dir/Discord/app-1.0.100" >/dev/null'

echo "with BetterDiscord:"
rm -rf "$local_dir/Discord" "$fixture/original"
make_version 1.0.100 bd
cp -r "$local_dir/Discord" "$fixture/original"
ps1
heal 1.0.100
check "BetterDiscord's redirect gets the hook" 'head -1 "$local_dir/Discord/app-1.0.100/resources/app/index.js" | grep -qF "de-enshittify-discord-hook"'
check "BetterDiscord's redirect is otherwise unchanged" '[[ "$(tail -n +2 "$local_dir/Discord/app-1.0.100/resources/app/index.js")" == "$(cat "$fixture/original/app-1.0.100/resources/app/index.js")" ]]'
ps1 -Uninstall
check "uninstall restores the original files exactly" 'diff -r "$fixture/original/app-1.0.100" "$local_dir/Discord/app-1.0.100" >/dev/null'

if (( fails )); then echo "$fails failed"; exit 1; fi
echo "all passed"
