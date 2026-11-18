#!/usr/bin/env node
// Checks src/renderer.js against Discord's live web client without touching the installed app:
// downloads the scripts discord.com/app loads, runs the webpack runtime in a bare VM context with the
// patcher installed, and reports which patches applied and compiled. Exits 1 if any didn't.
// Run it after a Discord update, before restarting the client.
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const origin = 'https://discord.com';
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const rendererPath = fileURLToPath(new URL('../src/renderer.js', import.meta.url));

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(origin + path, { headers: { 'user-agent': ua } });
      if (res.ok) return await res.text();
      if (attempt === 3) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (attempt === 3) throw new Error(`${path}: ${e.message}`);
    }
  }
}

const html = await get('/app');
// The page's own <script src> tags, in document order (they're all `defer`, so they run in this order).
const scripts = [...new Set([...html.matchAll(/<script\b[^>]*\bsrc="(\/assets\/[\w.-]+\.js)"/g)].map((m) => m[1]))];
const runtime = scripts.find((s) => /\/web\.\w+\.js$/.test(s));
if (!runtime) {
  console.error('No web.*.js runtime referenced by /app: the page layout changed, the checker needs updating.');
  process.exit(2);
}

const sources = new Map();
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < scripts.length) {
      const s = scripts[next++];
      sources.set(s, await get(s));
    }
  }),
);

// A bare context: nothing from this Node process is passed in.
const ctx = vm.createContext({});
vm.runInContext(
  `globalThis.window = globalThis; globalThis.self = globalThis; globalThis.__logs = [];
   globalThis.console = Object.fromEntries(['log','info','warn','error','debug'].map(l => [l, (...a) => __logs.push(l + ': ' + a.map(String).join(' '))]));
   globalThis.location = { origin: ${JSON.stringify(origin)}, href: ${JSON.stringify(origin + '/app')}, protocol: 'https:', hostname: 'discord.com', pathname: '/app' };
   globalThis.navigator = { userAgent: ${JSON.stringify(ua)} };
   // The runtime touches the DOM while it initialises; a stub that accepts anything lets it finish,
   // so later chunks are processed (and patched) through the module table like in the client.
   const anything = new Proxy(function () {}, {
     get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : anything),
     apply: () => anything,
     construct: () => anything,
     set: () => true,
   });
   globalThis.document = anything;`,
  ctx,
);
vm.runInContext(fs.readFileSync(rendererPath, 'utf8'), ctx, { filename: 'renderer.js' });

// Same order as the client: chunks queue up in webpackChunkdiscord_app, smaller bundles with their own
// webpack runtime run on the way, and web.js (the main runtime) comes last and processes the queue.
// Discord's own startup code throws here for want of a real DOM; that's expected.
for (const s of scripts) {
  try {
    vm.runInContext(sources.get(s), ctx, { filename: s, timeout: 30000 });
  } catch {}
}

const report = JSON.parse(vm.runInContext('JSON.stringify(__deEnshittifyDiscord.report())', ctx));
const patches = JSON.parse(vm.runInContext('JSON.stringify(__deEnshittifyDiscord.patches)', ctx));
const logs = JSON.parse(vm.runInContext('JSON.stringify(__logs.filter(l => l.includes("[de-enshittify-discord]")))', ctx));

console.log(`Discord web client: ${scripts.length} scripts, runtime ${runtime}`);
console.log(
  report.hooked
    ? `webpack runtimes hooked: ${report.runtimes.map((r) => `${r.modules} modules in ${r.ms} ms`).join(', ')}`
    : 'webpack NOT hooked',
);
let ok = report.hooked;
for (const { name, why } of patches) {
  if (name in report.applied) {
    console.log(`  ok    ${name} (module ${report.applied[name]}): ${why}`);
  } else if (name in report.missed) {
    ok = false;
    const m = report.missed[name];
    console.log(`  FAIL  ${name}: module ${m.module} found, but replacement #${m.step} no longer matches`);
  } else {
    ok = false;
    console.log(`  FAIL  ${name}: anchor not found in any module`);
  }
}
for (const e of report.errors) {
  ok = false;
  console.log(`  FAIL  module ${e.module} did not compile after ${e.patches.join(', ')}: ${e.error}`);
}
console.log(`popup types treated as dismissed: ${report.popupTypesBlocked}`);
for (const l of logs) console.log(`  log   ${l}`);
console.log(ok ? 'All patches apply to the current Discord build.' : 'Some patches need updating.');
process.exit(ok ? 0 : 1);
