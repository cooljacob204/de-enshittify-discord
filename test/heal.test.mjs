// Tests src/heal.js against throwaway copies of Discord's install layout (node --test test/).
// app.asar is a real folder here; inside Discord, Electron makes the asar file read like one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { heal, MARKER, HOOK, REDIRECT_MARKER } = require('../src/heal.js');

const CORE = "module.exports = require('./core.asar');";
const BD_INDEX = '\nrequire("C:\\\\BetterDiscord\\\\main.js");\nrequire("../betterdiscord.app.asar");\n';

// Builds <root>/app-<version> with a desktop core module and resources/app.asar, optionally with
// BetterDiscord's resources/app redirect instead.
function makeVersion(root, version, { betterDiscord = false, name = 'discord' } = {}) {
  const app = path.join(root, `app-${version}`);
  const core = path.join(app, 'modules', 'discord_desktop_core-1', 'discord_desktop_core');
  fs.mkdirSync(core, { recursive: true });
  fs.writeFileSync(path.join(core, 'index.js'), CORE);
  const resources = path.join(app, 'resources');
  const asar = path.join(resources, betterDiscord ? 'betterdiscord.app.asar' : 'app.asar');
  fs.mkdirSync(asar, { recursive: true });
  fs.writeFileSync(path.join(asar, 'package.json'), JSON.stringify({ name, main: 'bundle.js' }));
  if (betterDiscord) {
    fs.mkdirSync(path.join(resources, 'app'));
    fs.writeFileSync(path.join(resources, 'app', 'index.js'), BD_INDEX);
    fs.writeFileSync(path.join(resources, 'app', 'package.json'), '{"name":"discord","main":"index.js"}');
  }
  return { core: path.join(core, 'index.js'), resources };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'de-enshittify-heal-'));
}

test('hooks the core and creates a redirect when no other mod is installed', () => {
  const root = tempRoot();
  const v = makeVersion(root, '1.0.100');
  const changed = heal(root, '1.0.100');
  assert.equal(changed.length, 2);
  assert.equal(fs.readFileSync(v.core, 'utf8'), `${HOOK}\n${CORE}`);
  const index = fs.readFileSync(path.join(v.resources, 'app', 'index.js'), 'utf8');
  assert.ok(index.startsWith(HOOK + '\n'));
  assert.ok(index.includes('require("../app.asar");') && index.includes(REDIRECT_MARKER));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(v.resources, 'app', 'package.json'), 'utf8')), {
    name: 'discord',
    main: 'index.js',
  });
  assert.ok(fs.existsSync(path.join(v.resources, 'app.asar')), "Discord's app.asar is left in place");
  assert.ok(!fs.existsSync(path.join(v.resources, 'app.de-enshittify-tmp')));
});

test('is idempotent', () => {
  const root = tempRoot();
  makeVersion(root, '1.0.100');
  heal(root, '1.0.100');
  assert.deepEqual(heal(root, '1.0.100'), []);
});

test("keeps PTB/Canary's own app name in the redirect", () => {
  const root = tempRoot();
  const v = makeVersion(root, '1.0.100', { name: 'discordptb' });
  heal(root, '1.0.100');
  assert.equal(JSON.parse(fs.readFileSync(path.join(v.resources, 'app', 'package.json'), 'utf8')).name, 'discordptb');
});

test("adds the hook to BetterDiscord's redirect instead of replacing it", () => {
  const root = tempRoot();
  const v = makeVersion(root, '1.0.100', { betterDiscord: true });
  heal(root, '1.0.100');
  assert.equal(fs.readFileSync(path.join(v.resources, 'app', 'index.js'), 'utf8'), `${HOOK}\n${BD_INDEX}`);
});

test('hooks a newly installed version, skips older ones', () => {
  const root = tempRoot();
  const old = makeVersion(root, '1.0.99');
  makeVersion(root, '1.0.100');
  const next = makeVersion(root, '1.0.101');
  heal(root, '1.0.100');
  assert.ok(fs.readFileSync(next.core, 'utf8').includes(MARKER));
  assert.ok(fs.existsSync(path.join(next.resources, 'app', 'index.js')));
  assert.equal(fs.readFileSync(old.core, 'utf8'), CORE);
  assert.ok(!fs.existsSync(path.join(old.resources, 'app')));
});

test('compares versions numerically', () => {
  const root = tempRoot();
  makeVersion(root, '1.0.9269');
  const next = makeVersion(root, '1.0.10000');
  heal(root, '1.0.9269');
  assert.ok(fs.readFileSync(next.core, 'utf8').includes(MARKER));
});

test('re-adds the hook when another mod later overwrites the redirect', () => {
  const root = tempRoot();
  const v = makeVersion(root, '1.0.100');
  heal(root, '1.0.100');
  fs.writeFileSync(path.join(v.resources, 'app', 'index.js'), BD_INDEX);
  assert.equal(heal(root, '1.0.100').length, 1);
  assert.equal(fs.readFileSync(path.join(v.resources, 'app', 'index.js'), 'utf8'), `${HOOK}\n${BD_INDEX}`);
});

test("doesn't create a redirect when Discord's package.json can't be read", () => {
  const root = tempRoot();
  const v = makeVersion(root, '1.0.100');
  fs.rmSync(path.join(v.resources, 'app.asar', 'package.json'));
  heal(root, '1.0.100');
  assert.ok(!fs.existsSync(path.join(v.resources, 'app')));
});
