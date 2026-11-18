// de-enshittify-discord, main-process side. Required from a one-line hook that install.sh adds to
// Discord's startup files. It only registers preload.js as a session preload: it doesn't touch
// BrowserWindow, so it sits alongside BetterDiscord (which replaces BrowserWindow) without conflict.
'use strict';
if (!global.__deEnshittifyDiscordLoaded) {
  global.__deEnshittifyDiscordLoaded = true;
  const { app, session } = require('electron');
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
}
