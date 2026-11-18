# de-enshittify discord

Removes Quests, the Shop and ad popups from Discord: the Windows desktop client and Discord for
Android.

Neither hides anything with CSS or by covering it up. Both change Discord's own code as it loads, so
the Quests and Shop entry points are never created, the quest store never receives quests, and ad
popups are treated as already dismissed. When Discord changes the code a patch targets, that patch
steps aside: the feature comes back and the app keeps working.

> Not affiliated with or endorsed by Discord. Modifying the client is against Discord's Terms of
> Service; use it at your own risk. This only removes UI and drops quest data on your device. It
> doesn't fake quest progress or send anything Discord's own client wouldn't.

- [Windows](#windows): a one-line installer that patches the desktop app in place.
- [Android](#android): a patch bundle for [Morphe](https://morphe.software), which builds a patched
  copy of Discord on your phone.

## Windows

A small loader in Discord's startup files rewrites a few of Discord's webpack modules just before
they run.

### What it changes

| Patch | Effect |
|---|---|
| `quest-store-empty` | The quest store only ever keeps the server's "nothing for you" answers (`/quests/@me`, `/quests/decision`, `/quests/earned-decision`). The quest bar, member-list and activity-panel promos, profile quest cards and gift-inventory quests have nothing to show: the client is in the same state as an account that isn't offered quests. |
| `dm-sidebar-shop`, `dm-sidebar-quests` | The Shop and Quests rows in the DM sidebar are never created. |
| `discover-quests-tab` | The Discover page leaves out its Quests tab. |
| `startup-quest-redirect` | Opening Discord never redirects to the Quests page. |
| `quest-page-route`, `shop-page-route` | The Quests page (`/quest-home`) and the Shop page (`/shop`) redirect to your DMs, so a remembered last page, an old link or a "visit the shop" button can't land there. |
| `popup-catalogue`, `popup-gate`, `popup-gate-legacy` | Ad popups, coachmarks, badges and banners count as already dismissed, so Discord never picks them to show: quest and Orbs promos, Shop and game-storefront promos, third-party partner offers (such as the "Reward" popover on Nitro Home), marketing campaigns and seasonal promos. The set is chosen by name from Discord's own list of popup types, so new campaigns using the same words are caught too. Nothing is written to your account. Discord's own feature notices and Nitro upsells are left alone. |
| `quest-link-embeds` | `discord.com/quests/<id>` links in chat stay plain links instead of becoming quest cards. |

Nitro, server shops and everything else are untouched.

### Install

Open PowerShell (right-click Start, then **Terminal**) and paste:

```powershell
irm https://raw.githubusercontent.com/cooljacob204/de-enshittify-discord/main/install.ps1 | iex
```

That's it. The installer copies the patch to `%APPDATA%\de-enshittify-discord`, hooks Discord,
restarts Discord if it's running (which drops you from any voice call), and waits for Discord to
confirm the patches loaded. It works for Discord, Discord PTB and Discord Canary, and alongside
BetterDiscord. You can [read the script](install.ps1) before running it.

It stays applied when Discord updates itself. Run the same line again any time to get the latest
patches.

#### Uninstall

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/cooljacob204/de-enshittify-discord/main/install.ps1))) -Uninstall
```

#### Checking it

About 20 seconds after Discord starts, the patch writes `%APPDATA%\de-enshittify-discord\status.json`
listing which patches applied and which ad popups it blocked. If Discord's developer tools are
enabled, the console shows the same under `[de-enshittify-discord]`.

### After Discord updates

- **Desktop updates** install into a new `app-x.y.z` folder, without the hook. The patch handles
  that itself: when Discord's updater finishes installing a new version, and whenever Discord
  quits, it hooks the new version before it first runs. What it did is logged in
  `%APPDATA%\de-enshittify-discord\heal.log`. If Quests and the Shop ever come back after an
  update anyway, run the install line again.
- **Web updates** (frequent) can change the code a patch targets. A patch that no longer matches is
  skipped and reported, and only that part of Discord comes back; the client keeps working. Those
  need a fix here, and running the install line again picks it up.

### Development (WSL)

`install.sh` runs the same `install.ps1`, but installs this checkout's `src/` instead of downloading:

```sh
./install.sh            # install src/ from this checkout; restarts Discord
./install.sh status     # are the hooks in place? what did the client last report?
./install.sh check      # do the patches still match Discord's current web build? (changes nothing)
./install.sh uninstall  # remove the hooks and the installed files; restarts Discord
```

`install` and `uninstall` take `--no-restart` to leave Discord running. `check` needs Node.js 18 or
newer: it downloads Discord's current web build and tests every patch against it without touching
the client.

Tests, neither of which touches the real Discord:

```sh
node --test test/heal.test.mjs   # src/heal.js against copies of Discord's install layout
test/install.test.sh             # install.ps1 install, self-healing and uninstall on a fake Discord install
```

### How it works

1. `install.ps1` copies `src/` to `%APPDATA%\de-enshittify-discord\` and adds one guarded `require` line
   at the top of Discord's startup files: `modules\discord_desktop_core-*\discord_desktop_core\index.js`,
   and also `resources\app\index.js` when another mod (such as BetterDiscord) has set that up. If
   the folder is ever removed, the line fails quietly and Discord starts normally.
2. `src/loader.js` (main process) registers `src/preload.js` as a session preload. It doesn't replace
   `BrowserWindow`, so it coexists with mods that do. It also runs `src/heal.js`, which keeps the
   hook in the running version and any newer one: at startup, when Discord's updater emits
   `host-updated`, and when Discord quits. Desktop updates are installed before Discord's core
   loads, so without another mod it also creates a small `resources\app` redirect (Electron loads
   it before `resources\app.asar`) that loads the patch and then Discord's untouched `app.asar`.
   That makes the loader run early enough to catch the update. Uninstalling removes it.
3. `src/preload.js` injects `src/renderer.js` into the page before Discord's own scripts load.
4. `src/renderer.js` catches each webpack runtime's `__webpack_require__.m = modules` assignment (the
   page has several; the main one loads last). It rewrites the source of the few modules that
   contain a patch's anchor string, and keeps a proxy on the module table so lazy-loaded chunks are
   patched too. It stays the outermost layer, so it still sees Discord's original code when another
   mod wraps the table.

Each patch is all-or-nothing. It has a `find` string that picks the module and one or more
`replace` steps. If any step no longer matches, the module loads exactly as Discord shipped it.

### Fixing a broken patch

1. Run `./install.sh check` to see which patch failed, and whether its anchor wasn't found or a
   replacement step stopped matching.
2. Find the new shape of that code in Discord's current bundle, then update the patch's `find` or
   regex in `src/renderer.js`.
3. Run `./install.sh check` until it passes, then `./install.sh` to try it in Discord.

## Android

A patch bundle for [Morphe](https://morphe.software), an open-source app patcher (a fork of
ReVanced). Morphe patches Discord on your phone, and the patched app installs next to the official
one as **Discord Renewed**, the way ReVanced and Morphe handle YouTube. This repository only
publishes the patches: no Discord code, and no patched app.

### Install

1. Install Morphe from [morphe.software](https://morphe.software).
2. In Morphe, open **Sources**, tap **+**, choose **Remote** and add
   `https://github.com/cooljacob204/de-enshittify-discord`.
3. Choose Discord and patch it. Morphe sends you to APKMirror for Discord's split bundle (`.apkm`),
   checks that it's signed by Discord, merges and patches it on your phone, and installs it.

Morphe tells you when there's a new version of these patches. When Discord updates, patch the new
version the same way; Discord's frequent over-the-air updates to its JavaScript arrive by
themselves. If a Discord update changes something a patch relies on, that patch steps aside and a
short message names it.

To use the Discord you installed from the Play Store instead of APKMirror, turn it into a single
APK first (for example with [AntiSplit M](https://github.com/AbdurazaaqMohammed/AntiSplit-M)) and
pick that file in Morphe.

### What it changes

| Patch | Effect |
|---|---|
| `quest-store-empty` | As on Windows: the quest store only keeps the server's "nothing for you" answers, so quest cards and promos have nothing to show. |
| `quests-hidden` | Discord's own quest switch, the one it turns off on Meta Quest headsets, is off: no Quests button on the You screen, no quest dock above the bar at the bottom of the Messages screen (quests and the "Bounties" video ads), no quest entry points elsewhere. |
| `orbs-hidden` | Discord's own Orbs switch, also off on Meta Quest, is off: no Orbs Balance card on the You screen and no Orb wallet. |
| `shop-button` | The Shop button on the You screen is gone. |
| `shop-settings-row` | The Shop row in Settings is gone. |
| `popup-catalogue`, `popup-gate`, `popup-gate-shown`, `popup-gate-legacy` | As on Windows: ad popups, coachmarks and badges count as already dismissed, chosen by name from Discord's list of popup types. On Android that also covers Orbs onboarding, Bounties and Shop wishlist tips. Ad popups are never recorded as shown, so they don't use up Discord's daily popup limit. |

Two more options in Morphe: **Change package name** (on by default) makes the patched app a separate
app named "Discord Renewed" (both names can be changed), and **De-enshittify** is the patch itself.

Not covered yet: the Wishlist tab and Shop links on profiles, quest cards for quest links in chat,
and `discord.com/shop` and `discord.com/quests` links.

### How it works

1. The patch adds a small class to Discord with the script below embedded, and makes React Native's
   two bundle loaders (for the bundle in the APK and for one Discord downloaded over the air) run it
   just before Discord's own code.
2. Discord's code is Hermes bytecode, so the script can't rewrite source like the Windows patch does.
   It wraps Metro's module definitions (`__d`) and patches a module's exports right after the module
   runs. Modules are picked by their source file path, which each module in Discord's bundle reports
   as it finishes loading (such as `modules/quests/lib/QuestsEligibility.tsx`).
3. The rename changes only the manifest: the package, the labels, and the provider authorities and
   permissions that must be unique per phone. Discord's resource lookups go through a small added
   helper, so a lookup under either package name finds Discord's resources.

### Development

`android/build.sh` (WSL or Linux) builds and tests the bundle. Building needs Java 17 or newer and a
GitHub token with `read:packages`, which Morphe's Gradle plugin and patcher need to download
(`gh auth refresh -h github.com -s read:packages`).

```sh
android/build.sh               # build android/patches/build/libs/patches-<version>.mpp
android/build.sh test          # test the script against an imitation of Discord's module system
android/build.sh patch FILE    # patch a Discord .apk/.apkm/.apks for your own phone (Java 21 + Morphe Desktop)
android/build.sh release       # publish the bundle as a GitHub release and update patches-bundle.json
```

`release` publishes the version in `android/gradle.properties`, so bump it first. Morphe Manager
reads `patches-bundle.json` at the root of this repository to find the newest bundle.

The patch code is in `android/patches/src/main/kotlin/` and the script in
`android/patches/src/main/resources/de-enshittify-discord.js`. To find what to patch in a new
Discord version, decompile `assets/index.android.bundle` from its APK with
[hermes-dec](https://github.com/P1sec/hermes-dec); most module paths and function names survive in
the bytecode.

## License

[MIT](LICENSE)
