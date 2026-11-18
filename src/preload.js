// de-enshittify-discord, preload side. Registered as a session preload by loader.js, so it runs in each
// Discord window's preload context (isolated world, before the page's own scripts). For the main
// client page it injects renderer.js into the page, and it writes the status the page reports back
// to status.json beside this file.
'use strict';
const { webFrame } = require('electron');
const fs = require('fs');
const path = require('path');

if (/^(?:ptb\.|canary\.)?discord\.com$/.test(location.hostname) && !location.pathname.startsWith('/popout')) {
  try {
    const code = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
    webFrame.executeJavaScript(`${code}\n//# sourceURL=de-enshittify-discord/renderer.js`);
  } catch (e) {
    console.error('[de-enshittify-discord] could not inject renderer.js', e);
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'de-enshittify-discord:status' || typeof data.status !== 'object') return;
    try {
      fs.writeFileSync(path.join(__dirname, 'status.json'), JSON.stringify(data.status, null, 2).slice(0, 65536));
    } catch {}
  });
}
