#!/usr/bin/env bash
# de-enshittify discord for Android: development helper (WSL/Linux).
#
#   ./build.sh             build the Morphe patch bundle (patches/build/libs/patches-<version>.mpp)
#   ./build.sh test        run the script's tests (Node.js 18+)
#   ./build.sh patch FILE  patch a Discord APK or split bundle (.apkm/.apks/.xapk) with Morphe Desktop,
#                          for testing on your own phone (needs Java 21 and morphe-desktop-*-all.jar,
#                          see MORPHE_DESKTOP below)
#   ./build.sh release     publish patches-<version>.mpp as a GitHub release and point the repo's
#                          patches-bundle.json (what Morphe Manager reads) at it; commits and pushes
#
# Morphe publishes its Gradle plugin and patcher on GitHub Packages, which needs a GitHub token with
# read:packages even for public packages. This passes the gh CLI's token
# (`gh auth refresh -h github.com -s read:packages` adds that scope).
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/.." && pwd)
version=$(sed -n 's/^version = //p' "$here/gradle.properties")
bundle="$here/patches/build/libs/patches-$version.mpp"

# The APKs `patch` makes are signed with this key, so newer test builds install over older ones.
keystore=${KEYSTORE:-$HOME/.config/de-enshittify-discord/discord.keystore}
morphe_desktop=${MORPHE_DESKTOP:-$HOME/.local/share/morphe/morphe-desktop-all.jar}
java21=${JAVA21:-/usr/lib/jvm/java-21-openjdk-amd64/bin/java}

build() {
  (cd "$here" && GITHUB_ACTOR=$(gh api user --jq .login) GITHUB_TOKEN=$(gh auth token) ./gradlew --no-daemon -q buildAndroid)
  echo "built $bundle"
}

case ${1:-build} in
  build)
    build
    ;;
  test)
    exec node --test "$here/test/"*.test.mjs
    ;;
  patch)
    input=${2:?usage: $0 patch DISCORD.apk|.apkm|.apks|.xapk}
    if [[ ! -f $morphe_desktop ]]; then
      echo "Morphe Desktop not found at $morphe_desktop. Download morphe-desktop-*-all.jar from" >&2
      echo "https://github.com/MorpheApp/morphe-desktop/releases and save it there (or set MORPHE_DESKTOP)." >&2
      exit 1
    fi
    build
    mkdir -p "$(dirname "$keystore")"
    out="$here/build/discord-renewed-$version.apk"
    mkdir -p "$here/build"
    "$java21" -Djava.awt.headless=true -jar "$morphe_desktop" patch -p "$bundle" \
      --keystore "$keystore" --keystore-entry-alias "ReVanced Key" --keystore-entry-password "" \
      -t "$here/build/morphe-tmp" -o "$out" "$input"
    echo "patched: $out (for your own phone only: it contains Discord's code, don't share it)"
    ;;
  release)
    tag="v$version"
    if gh release view "$tag" >/dev/null 2>&1; then
      echo "$tag is already released; bump version in gradle.properties first" >&2
      exit 1
    fi
    if [[ -n $(git -C "$repo" status --porcelain) ]]; then
      echo "commit your changes first" >&2
      exit 1
    fi
    build
    notes=${NOTES:-"de-enshittify discord for Android $version"}
    gh release create "$tag" "$bundle" --title "v$version" --notes "$notes"
    url=$(gh release view "$tag" --json assets --jq '.assets[] | select(.name | endswith(".mpp")) | .url')
    page=$(gh release view "$tag" --json url --jq .url)
    # Morphe Manager reads created_at as a local date-time in UTC: no "Z" or offset, or it rejects the
    # whole file. page_url is the release page (it would otherwise guess one from the version).
    jq -n --arg version "$version" --arg url "$url" --arg page "$page" --arg date "$(date -u +%Y-%m-%dT%H:%M:%S)" --arg notes "$notes" \
      '{version: $version, download_url: $url, page_url: $page, created_at: $date, description: $notes}' > "$repo/patches-bundle.json"
    git -C "$repo" add patches-bundle.json
    git -C "$repo" commit -q -m "Release v$version"
    git -C "$repo" push -q
    echo "released $tag; Morphe Manager picks it up from patches-bundle.json"
    ;;
  *)
    echo "usage: $0 [build|test|patch FILE|release]" >&2
    exit 2
    ;;
esac
