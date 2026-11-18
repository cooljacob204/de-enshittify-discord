// de-enshittify discord, main-process side. Required from the one-line hook in Discord's startup
// files. It registers preload.js as a session preload (without touching BrowserWindow, so it sits
// alongside BetterDiscord, which replaces BrowserWindow), and keeps the hook in place across
// Discord updates (heal.js).
'use strict';
if (!global.__deEnshittifyDiscordLoaded) {
  global.__deEnshittifyDiscordLoaded = true;
  const { app, session } = require('electron');
  const { EventEmitter } = require('events');
  const fs = require('fs');
  const path = require('path');
  const preload = path.join(__dirname, 'preload.js');

  const register = () => {
    try {
      const ses = session.defaultSession;
      if (typeof ses.registerPreloadScript === 'function') {
        ses.registerPreloadScript({ type: 'frame', id: 'de-enshittify-discord', filePath: preload });
      } else {
        ses.setPreloads([...ses.getPreloads(), preload]);
      }
    } catch (e) {
      console.error('[de-enshittify-discord] could not register the preload', e);
    }
  };

  if (app.isReady()) register();
  else app.once('ready', register);

  // Self-healing (Windows): hook the running version and any newer one at startup, right after
  // Discord's updater installs a new version, and when Discord quits. Changes go to heal.log.
  // Once uninstalled (this folder is gone) it does nothing, so quitting a Discord that still has
  // this loaded can't put the hook back.
  const execDir = path.dirname(process.execPath);
  if (process.platform === 'win32' && path.basename(execDir).startsWith('app-')) {
    const { heal } = require('./heal');
    const root = path.dirname(execDir);
    const current = path.basename(execDir).slice(4);
    const log = (line) => {
      try {
        fs.appendFileSync(path.join(__dirname, 'heal.log'), `${new Date().toISOString()} ${line}\n`);
      } catch {}
    };
    const run = (when) => {
      try {
        if (!fs.existsSync(path.join(__dirname, 'loader.js'))) return;
        const changed = heal(root, current);
        if (changed.length) log(`${when}: hooked ${changed.join(', ')}`);
      } catch (e) {
        log(`${when}: failed: ${(e && e.stack) || e}`);
      }
    };

    run('startup');
    app.on('before-quit', () => run('before-quit'));
    process.on('exit', () => run('exit'));
    // Discord's updater emits "host-updated" once a new version is installed, before it restarts
    // into it. It's caught on EventEmitter's prototype (as BetterDiscord does) since the updater
    // object isn't reachable from here.
    EventEmitter.prototype.emit = new Proxy(EventEmitter.prototype.emit, {
      apply(target, self, args) {
        const result = Reflect.apply(target, self, args);
        if (args[0] === 'host-updated') run('host-updated');
        return result;
      },
    });
  }
}
