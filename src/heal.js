// de-enshittify discord, self-healing: keeps the hook in place across Discord updates.
//
// Discord installs each desktop update into a new app-x.y.z folder, which doesn't have the hook.
// loader.js calls heal() at startup, when Discord's updater has installed a new version
// ("host-updated"), and when Discord quits, so a new version is hooked before it first runs.
//
// For the running version and any newer one, it makes sure that:
//  - modules/discord_desktop_core-*/discord_desktop_core/index.js starts with the hook line. This
//    loads the patch when Discord's core starts.
//  - resources/app/index.js starts with the hook line. If another mod (BetterDiscord) made that
//    folder, the line goes into its file. Otherwise a small redirect folder is created: Electron
//    loads resources/app before resources/app.asar, and the redirect loads the patch, then
//    Discord's own app.asar, which is left untouched. This early hook matters because desktop
//    updates are installed while Discord's updater runs, before the core (and the other hook) loads.
//
// Plain fs operations, no Electron APIs, so it can be tested outside Discord.
'use strict';
const fs = require('fs');
const path = require('path');

const MARKER = '// de-enshittify-discord-hook';
const HOOK = `try{require(require("path").join(process.env.APPDATA,"de-enshittify-discord","loader.js"))}catch(e){console.error("[de-enshittify-discord] hook failed:",e)} ${MARKER}`;
const REDIRECT_MARKER = '// de-enshittify-discord-redirect';

function compareVersions(a, b) {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0);
  const y = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Prepends the hook line; the rest of the file is kept exactly as it was.
function hookFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(MARKER)) return false;
  fs.writeFileSync(file, `${HOOK}\n${text}`);
  return true;
}

// Creates resources/app as a redirect to resources/app.asar, keeping the app's name from its own
// package.json (Discord, PTB and Canary differ). Built in a temporary folder and renamed into
// place, so a half-written redirect is never loaded.
function createRedirect(resources) {
  let name;
  try {
    name = JSON.parse(fs.readFileSync(path.join(resources, 'app.asar', 'package.json'), 'utf8')).name;
  } catch {
    return false;
  }
  if (!name) return false;
  const dir = path.join(resources, 'app');
  const tmp = path.join(resources, 'app.de-enshittify-tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
  fs.writeFileSync(path.join(tmp, 'index.js'), `${HOOK}\nrequire("../app.asar"); ${REDIRECT_MARKER}\n`);
  fs.renameSync(tmp, dir);
  return true;
}

// root: the Discord install folder (the parent of the app-* folders). current: the running version,
// e.g. "1.0.9269"; older versions are skipped since Discord no longer uses them.
// Returns the paths it changed.
function heal(root, current) {
  const changed = [];
  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith('app-')) continue;
    if (current && compareVersions(entry.slice(4), current) < 0) continue;
    const app = path.join(root, entry);
    if (!isDir(app)) continue;

    const modules = path.join(app, 'modules');
    if (isDir(modules)) {
      for (const m of fs.readdirSync(modules)) {
        if (!m.startsWith('discord_desktop_core-')) continue;
        const file = path.join(modules, m, 'discord_desktop_core', 'index.js');
        if (fs.existsSync(file) && hookFile(file)) changed.push(file);
      }
    }

    const resources = path.join(app, 'resources');
    const appDir = path.join(resources, 'app');
    const appIndex = path.join(appDir, 'index.js');
    if (fs.existsSync(appIndex)) {
      if (hookFile(appIndex)) changed.push(appIndex);
    } else if (!fs.existsSync(appDir) && fs.existsSync(path.join(resources, 'app.asar'))) {
      if (createRedirect(resources)) changed.push(appDir);
    }
  }
  return changed;
}

module.exports = { heal, compareVersions, MARKER, HOOK, REDIRECT_MARKER };
