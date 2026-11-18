// Tests the Android script (patches/src/main/resources/de-enshittify-discord.js) against a small
// imitation of Discord's module system: Metro's prelude setting the global `__d`, modules defined as
// __d(factory, id, dependencyMap), an import tracker every module reports its path to, Discord's Flux
// Dispatcher class and a QuestStore registering its action handlers (node --test android/test/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SCRIPT = fs.readFileSync(new URL('../patches/src/main/resources/de-enshittify-discord.js', import.meta.url), 'utf8');

// A cut-down Metro runtime, as Discord's bundle sets it up after our script has run.
const METRO_PRELUDE = `
(function (global) {
  var modules = new Map();
  function define(factory, id, dependencyMap) {
    if (modules.has(id)) return;
    modules.set(id, { factory, dependencyMap, isInitialized: false, publicModule: { exports: {} } });
  }
  function metroRequire(id) {
    var m = modules.get(id);
    if (m.isInitialized) return m.publicModule.exports;
    m.isInitialized = true;
    var moduleObject = m.publicModule;
    m.factory.call(undefined, global, metroRequire, null, null, moduleObject, moduleObject.exports, m.dependencyMap);
    return moduleObject.exports;
  }
  global.__r = metroRequire;
  global.__d = define;
})(globalThis);
`;

// Modules shaped like the ones in Discord's bundle (see android/README notes on the real ones).
const DISCORD_MODULES = `
__d(function (g, r, i, a, m, e, d) {
  e.fileFinishedImporting = function (path) { (g.imported = g.imported || []).push(path); };
}, 1, []);

__d(function (g, r, i, a, m, e, d) {
  class Dispatcher {
    constructor() { this.handlers = {}; }
    register(name, handlers) { this.handlers[name] = handlers; return name; }
    dispatch(action) {
      for (var name in this.handlers) {
        var h = this.handlers[name][action.type];
        if (h) h(action);
      }
    }
  }
  e.Dispatcher = Dispatcher;
  r(d[0]).fileFinishedImporting('../discord_common/js/packages/flux/Dispatcher.tsx');
}, 2, [1]);

__d(function (g, r, i, a, m, e, d) {
  var Dispatcher = r(d[1]).Dispatcher;
  var dispatcher = new Dispatcher();
  var store = { quests: null, delivered: 'untouched', earned: null };
  dispatcher.register('QuestStore', {
    QUESTS_FETCH_CURRENT_QUESTS_SUCCESS: function (action) { store.quests = action.quests.concat(action.excludedQuests); },
    QUESTS_FETCH_QUEST_TO_DELIVER_SUCCESS: function (action) { store.delivered = action.quest; },
    QUESTS_FETCH_EARNED_QUEST_TO_DELIVER_SUCCESS: function (action) { store.earned = Array.from(action.serverQuests); },
  });
  dispatcher.register('OtherStore', {
    QUESTS_FETCH_CURRENT_QUESTS_SUCCESS: function (action) { store.other = action.quests.length; },
  });
  r(d[0]).fileFinishedImporting('modules/quests/QuestStore.tsx');
  e.default = { store, dispatcher };
}, 3, [1, 2]);

__d(function (g, r, i, a, m, e, d) {
  e.getIsEligibleForQuests = function () { return true; };
  r(d[0]).fileFinishedImporting('modules/quests/lib/QuestsEligibility.tsx');
  Object.freeze(e);
}, 10, [1]);

__d(function (g, r, i, a, m, e, d) {
  e.isVirtualCurrencyEnabled = function () { return true; };
  e.useVirtualCurrencyMobileEnabled = function () { return { enabled: true }; };
  r(d[0]).fileFinishedImporting('modules/virtual_currency/hooks/native/useVirtualCurrencyMobileEnabled.tsx');
}, 11, [1]);

__d(function (g, r, i, a, m, e, d) {
  e.default = function CollectiblesShopEntryButton() { return 'shop button'; };
  r(d[0]).fileFinishedImporting('modules/collectibles/native/CollectiblesShopEntryButton.tsx');
}, 12, [1]);

__d(function (g, r, i, a, m, e, d) {
  e.default = { type: 'route', useTitle: function () {}, getComponent: function () {}, usePreNavigationAction: function () {} };
  r(d[0]).fileFinishedImporting('modules/user_settings/defs/native/CollectiblesShopSetting.tsx');
}, 13, [1]);

__d(function (g, r, i, a, m, e, d) {
  var D = {};
  D[D.MACARON_3P_POPOVER = 5] = 'MACARON_3P_POPOVER';
  D[D.QUEST_HOME_MOVE_CALLOUT = 6] = 'QUEST_HOME_MOVE_CALLOUT';
  D[D.VIRTUAL_CURRENCY_MOBILE_ONBOARDING_PILL = 7] = 'VIRTUAL_CURRENCY_MOBILE_ONBOARDING_PILL';
  D[D.NITRO_TAB_BADGE_COUNTDOWN = 8] = 'NITRO_TAB_BADGE_COUNTDOWN';
  D[D.WHATS_NEW_SOMETHING = 9] = 'WHATS_NEW_SOMETHING';
  e.DismissibleContent = D;
  r(d[0]).fileFinishedImporting('../discord_common/js/packages/protos/discord_protos/discord_users/v1/dismissible_content.tsx');
}, 14, [1]);

__d(function (g, r, i, a, m, e, d) {
  e.useSelectedDismissibleContentShared = function (content) { (g.shown = g.shown || []).push(content); };
  r(d[0]).fileFinishedImporting('modules/dismissible_content/useSelectedDismissibleContentShared.tsx');
}, 16, [1]);

__d(function (g, r, i, a, m, e, d) {
  // Like Discord's: pick the first candidate, record it as shown, return [content, dismiss].
  e.useSelectedDismissibleContent = function (contents) {
    var picked = contents.length ? contents[0] : null;
    r(d[1]).useSelectedDismissibleContentShared(picked);
    return [picked, 'dismiss'];
  };
  e.useSelectedScopedDismissibleContent = function (entries) {
    var picked = entries.length ? entries[0].content : null;
    r(d[1]).useSelectedDismissibleContentShared(picked);
    return [picked, 'dismiss'];
  };
  e.useSelectedVersionedDismissibleContent = function (content) {
    r(d[1]).useSelectedDismissibleContentShared(content);
    return [content, 'dismiss'];
  };
  r(d[0]).fileFinishedImporting('modules/dismissible_content/hooks/useSelectedDismissibleContent.tsx');
}, 15, [1, 16]);

__d(function (g, r, i, a, m, e, d) {
  e.UNSAFE_isDismissibleContentDismissed = function () { return false; };
  e.useIsDismissibleContentDismissed_UNSAFE = function () { (g.hookCalls = (g.hookCalls || 0) + 1); return false; };
  r(d[0]).fileFinishedImporting('modules/dismissible_content/DismissibleContentUnsafeUtils.tsx');
}, 17, [1]);
`;

// Requires every module, as Discord does over time.
const ALL = '[3, 10, 11, 12, 13, 14, 15, 16, 17].forEach(function (id) { __r(id); })';

// Values from the vm context have that context's prototypes; compare them as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

function run(modules = DISCORD_MODULES) {
  const logs = [];
  const timers = [];
  const toasts = [];
  const context = vm.createContext({
    console: { log: (...args) => logs.push(args.join(' ')) },
    setTimeout: (fn) => timers.push(fn),
    __turboModuleProxy: (name) => (name === 'ToastAndroid' ? { show: (message) => toasts.push(message) } : null),
  });
  vm.runInContext(SCRIPT, context);
  vm.runInContext(METRO_PRELUDE, context);
  vm.runInContext(modules, context);
  const exports = vm.runInContext('__r(3)', context);
  return { context, exports, logs, timers, toasts, report: () => vm.runInContext('__deEnshittifyDiscord.report()', context) };
}

test('modules still load and report their paths through the wrapper', () => {
  const { context, report } = run();
  assert.deepEqual(plain(vm.runInContext('imported', context)), [
    '../discord_common/js/packages/flux/Dispatcher.tsx',
    'modules/quests/QuestStore.tsx',
  ]);
  const r = report();
  assert.equal(r.hooked, true);
  assert.equal(r.modules, 3);
  assert.equal(r.paths, 2);
});

test('QuestStore keeps only "nothing for you" answers', () => {
  const { exports, report } = run();
  const { store, dispatcher } = exports.default;
  dispatcher.dispatch({ type: 'QUESTS_FETCH_CURRENT_QUESTS_SUCCESS', quests: [{ id: 'a' }], excludedQuests: [{ id: 'b' }] });
  assert.deepEqual(plain(store.quests), []);
  dispatcher.dispatch({ type: 'QUESTS_FETCH_QUEST_TO_DELIVER_SUCCESS', quest: { id: 'c' } });
  assert.equal(store.delivered, 'untouched');
  dispatcher.dispatch({ type: 'QUESTS_FETCH_EARNED_QUEST_TO_DELIVER_SUCCESS', serverQuests: new Map([['q1', { id: 'q1' }]]) });
  assert.deepEqual(plain(store.earned), [['q1', null]]);
  assert.equal(report().applied['quest-store-empty'], 'QuestStore handlers wrapped');
  assert.equal(report().missed['quest-store-empty'], undefined);
});

test("other stores still see the real action", () => {
  const { exports } = run();
  const { store, dispatcher } = exports.default;
  dispatcher.dispatch({ type: 'QUESTS_FETCH_CURRENT_QUESTS_SUCCESS', quests: [{ id: 'a' }], excludedQuests: [] });
  assert.equal(store.other, 1);
});

test('steps aside when QuestStore changes shape', () => {
  const changed = DISCORD_MODULES.replace('QUESTS_FETCH_QUEST_TO_DELIVER_SUCCESS:', 'QUESTS_RENAMED:');
  const { exports, report } = run(changed);
  const { store, dispatcher } = exports.default;
  dispatcher.dispatch({ type: 'QUESTS_FETCH_CURRENT_QUESTS_SUCCESS', quests: [{ id: 'a' }], excludedQuests: [] });
  assert.deepEqual(plain(store.quests), [{ id: 'a' }]);
  assert.match(report().missed['quest-store-empty'], /expected action handlers/);
});

test('reports a patch whose module never showed up', () => {
  const noDispatcherPath = DISCORD_MODULES.replace("'../discord_common/js/packages/flux/Dispatcher.tsx'", "'moved/Dispatcher.tsx'");
  const { report } = run(noDispatcherPath);
  assert.deepEqual(plain(report().applied), {});
  assert.equal(report().missed['quest-store-empty'], undefined);
  assert.match(report().waiting['quest-store-empty'], /hasn't loaded yet/);
});

test('a module that throws still throws, and the wrapper keeps going', () => {
  const throwing = DISCORD_MODULES + `__d(function () { throw new Error('boom'); }, 4, []);`;
  const { context, report } = run(throwing);
  assert.throws(() => vm.runInContext('__r(4)', context), /boom/);
  assert.equal(report().modules, 4);
});

test('every patch applies to modules shaped like Discord\'s', () => {
  const { context, report } = run();
  vm.runInContext(ALL, context);
  const r = report();
  assert.deepEqual(Object.keys(r.missed), []);
  assert.deepEqual(Object.keys(r.waiting), []);
  assert.deepEqual(Object.keys(r.applied).sort(), [
    'orbs-hidden', 'popup-catalogue', 'popup-gate', 'popup-gate-legacy', 'popup-gate-shown',
    'quest-store-empty', 'quests-hidden', 'shop-button', 'shop-settings-row',
  ]);
  assert.equal(r.popupTypesBlocked, 3);
});

test('quests and Orbs are switched off the way Discord does it on Meta Quest', () => {
  const { context } = run();
  vm.runInContext(ALL, context);
  // The eligibility module froze its exports; it now hands out a patched copy.
  assert.equal(vm.runInContext('__r(10).getIsEligibleForQuests()', context), false);
  assert.equal(vm.runInContext('__r(11).isVirtualCurrencyEnabled()', context), false);
  assert.deepEqual(plain(vm.runInContext('__r(11).useVirtualCurrencyMobileEnabled()', context)), { enabled: false });
});

test('the Shop button renders nothing and the Shop settings row is hidden', () => {
  const { context } = run();
  vm.runInContext(ALL, context);
  assert.equal(vm.runInContext('__r(12).default()', context), null);
  assert.equal(vm.runInContext('__r(13).default.usePredicate()', context), false);
});

test('ad popups are skipped in favour of other popups, and never recorded as shown', () => {
  const { context, report } = run();
  vm.runInContext(ALL, context);
  // MACARON_3P_POPOVER (an ad) and QUEST_HOME_MOVE_CALLOUT are skipped; the Nitro badge is picked.
  assert.deepEqual(plain(vm.runInContext('__r(15).useSelectedDismissibleContent([5, 6, 8])', context)), [8, 'dismiss']);
  assert.deepEqual(plain(vm.runInContext('__r(15).useSelectedScopedDismissibleContent([{ content: 7 }, { content: 9 }])', context)), [9, 'dismiss']);
  assert.deepEqual(plain(vm.runInContext('__r(15).useSelectedVersionedDismissibleContent(5)', context)), [null, 'dismiss']);
  assert.deepEqual(plain(vm.runInContext('__r(15).useSelectedVersionedDismissibleContent(9)', context)), [9, 'dismiss']);
  assert.deepEqual(plain(vm.runInContext('shown', context)), [8, 9, null, 9]);
  assert.deepEqual(Object.keys(report().popupsSuppressed).sort(), ['MACARON_3P_POPOVER', 'QUEST_HOME_MOVE_CALLOUT', 'VIRTUAL_CURRENCY_MOBILE_ONBOARDING_PILL']);
});

test('direct "was it dismissed?" checks say yes for ad popups, and the hook still runs', () => {
  const { context } = run();
  vm.runInContext(ALL, context);
  assert.equal(vm.runInContext('__r(17).UNSAFE_isDismissibleContentDismissed(5)', context), true);
  assert.equal(vm.runInContext('__r(17).UNSAFE_isDismissibleContentDismissed(8)', context), false);
  assert.equal(vm.runInContext('__r(17).useIsDismissibleContentDismissed_UNSAFE(5)', context), true);
  assert.equal(vm.runInContext('__r(17).useIsDismissibleContentDismissed_UNSAFE(8)', context), false);
  assert.equal(vm.runInContext('hookCalls', context), 2);
});

test("there's no popup when everything applies, and screens not opened yet aren't failures", () => {
  const { timers, toasts, report } = run();
  timers.forEach((fn) => fn());
  // Only the quest store and its dispatcher have loaded; the other 8 patches wait for their screens.
  assert.deepEqual(toasts, []);
  assert.equal(Object.keys(report().waiting).length, 8);
});

test('the startup check names patches that failed', () => {
  const changed = DISCORD_MODULES.replace('QUESTS_FETCH_QUEST_TO_DELIVER_SUCCESS:', 'QUESTS_RENAMED:');
  const { timers, toasts } = run(changed);
  timers.forEach((fn) => fn());
  assert.deepEqual(toasts, ["de-enshittify 0.3.2: didn't apply: quest-store-empty"]);
});

test('a patch that fails after startup says so right away, by name', () => {
  const changed = DISCORD_MODULES.replace("e.default = function CollectiblesShopEntryButton() { return 'shop button'; };", '');
  const { context, timers, toasts } = run(changed);
  timers.forEach((fn) => fn());
  vm.runInContext('__r(12)', context); // the You screen is opened
  assert.deepEqual(toasts, ["de-enshittify 0.3.2: shop-button didn't apply"]);
});
