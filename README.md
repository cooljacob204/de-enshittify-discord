# de-enshittify discord

Removes Quests, the Shop and ad popups from the Windows Discord desktop client.

It doesn't hide anything with CSS. It rewrites a few of Discord's own JavaScript modules just before
they run, so the Quests and Shop entry points are never created, the quest store never receives
quests, and ad popups are treated as already dismissed. When Discord changes the code a patch
targets, that patch steps aside: the feature comes back and the client keeps working.

> Not affiliated with or endorsed by Discord. Modifying the client is against Discord's Terms of
> Service; use it at your own risk. This only removes UI and drops quest data on your machine. It
> doesn't fake quest progress or send anything Discord's own client wouldn't.

## What it changes

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

## Requirements

- Discord desktop (stable) for Windows, installed in the default location (`%LOCALAPPDATA%\Discord`).
- WSL with bash, since the installer runs from WSL and edits the Windows install.
- Node.js 18 or newer in WSL, only for `./install.sh check`.

It works alongside BetterDiscord.

## Install

```sh
git clone <this repo> && cd de-enshittify-discord
./install.sh
```

If Discord is running, the installer restarts it so the patch loads. That drops you from any voice
call; add `--no-restart` to skip it and restart Discord yourself later (quit from the tray icon,
since closing the window isn't enough). A page reload (Ctrl+R) isn't enough either, because Discord
only picks up the hook when its main process starts.

About 20 seconds after Discord starts, it writes `%APPDATA%\de-enshittify-discord\status.json` listing
which patches applied and which ad popups it blocked. `./install.sh status` prints it. If Discord's
developer tools are enabled, the console shows the same under `[de-enshittify-discord]`.

## Commands

```sh
./install.sh            # install, or re-apply after a Discord desktop update; restarts Discord
./install.sh status     # are the hooks in place? what did the client last report?
./install.sh check      # do the patches still match Discord's current web build? (changes nothing)
./install.sh uninstall  # remove the hooks and the installed files; restarts Discord
```

`install` and `uninstall` take `--no-restart` to leave Discord running.

## After Discord updates

- **Web updates** (frequent) can change the code a patch targets. A patch that no longer matches is
  skipped and reported, and that feature reappears. `./install.sh check` downloads Discord's
  current web build and tests every patch against it without touching your client.
- **Desktop updates** (a new `app-x.y.z` folder) replace the startup files that load this. Run
  `./install.sh` again (it restarts Discord). `./install.sh status` shows whether the hooks are there.

## How it works

1. `install.sh` copies `src/` to `%APPDATA%\de-enshittify-discord\` and adds one guarded `require` line
   at the top of Discord's startup files: `modules\discord_desktop_core-*\discord_desktop_core\index.js`,
   and also `resources\app\index.js` when another mod (such as BetterDiscord) has set that up. If
   the folder is ever removed, the line fails quietly and Discord starts normally.
2. `src/loader.js` (main process) registers `src/preload.js` as a session preload. It doesn't replace
   `BrowserWindow`, so it coexists with mods that do.
3. `src/preload.js` injects `src/renderer.js` into the page before Discord's own scripts load.
4. `src/renderer.js` catches each webpack runtime's `__webpack_require__.m = modules` assignment (the
   page has several; the main one loads last). It rewrites the source of the few modules that
   contain a patch's anchor string, and keeps a proxy on the module table so lazy-loaded chunks are
   patched too. It stays the outermost layer, so it still sees Discord's original code when another
   mod wraps the table.

Each patch is all-or-nothing. It has a `find` string that picks the module and one or more
`replace` steps. If any step no longer matches, the module loads exactly as Discord shipped it.

## Fixing a broken patch

1. Run `./install.sh check` to see which patch failed, and whether its anchor wasn't found or a
   replacement step stopped matching.
2. Find the new shape of that code in Discord's current bundle, then update the patch's `find` or
   regex in `src/renderer.js`.
3. Run `./install.sh check` until it passes, then `./install.sh` and restart Discord.

## License

[MIT](LICENSE)
