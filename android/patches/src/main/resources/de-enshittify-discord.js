// de-enshittify discord for Android.
//
// The APK patch makes React Native run this file in Discord's Hermes JS runtime right before Discord's
// own bundle. Discord's code is Hermes bytecode, so unlike the desktop patch this can't rewrite source.
// Instead it wraps Metro's module definitions (the bundle's global `__d`) and patches a module's
// exports right after the module has run. Modules are picked by their source file path, which every
// module in Discord's bundle reports when it finishes loading (`fileFinishedImporting(path)`).
//
// Each patch checks the shape of what it patches and steps aside if Discord changed it, so that part
// of Discord comes back and the rest of the app keeps working. It is plain ES2015 with no generators
// or async functions, since Discord's Hermes compiles it at load time.
(function () {
  'use strict';

  var TAG = '[de-enshittify-discord]';
  var VERSION = '0.3.1';

  var state = {
    version: VERSION,
    hooked: false, // our wrapper saw Discord's module system being set up
    modules: 0, // modules that ran through the wrapper
    paths: 0, // modules whose source path we learnt
    applied: {}, // patch name -> what it did
    missed: {}, // patch name -> why it didn't apply (Discord changed)
    waiting: {}, // patch name -> what it's waiting for (Discord loads most screens' code when first opened)
    popupTypesBlocked: 0,
    popupsSuppressed: {}, // names of ad popups Discord tried to show
    errors: [],
  };

  function log() {
    try {
      var args = [TAG];
      for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
      console.log.apply(console, args);
    } catch (e) {}
  }

  function fail(name, why) {
    state.missed[name] = String(why);
    delete state.waiting[name];
    log('patch', name, 'did not apply:', why);
    // After the startup report, say so right away (e.g. when a screen is opened for the first time).
    if (startupReportShown) toast('de-enshittify ' + VERSION + ': ' + name + " didn't apply");
  }

  function error(where, e) {
    var text = where + ': ' + ((e && e.stack) || e);
    if (state.errors.length < 20) state.errors.push(text);
    log('error in', text);
  }

  // -- Patches ---------------------------------------------------------------------------------

  // Wraps handlers[type] with replace(original, action, ...). Returns false if it isn't a function.
  function wrapHandler(handlers, type, replace) {
    var original = handlers[type];
    if (typeof original !== 'function') return false;
    handlers[type] = function () {
      var args = Array.prototype.slice.call(arguments);
      return replace.call(this, original, args);
    };
    return true;
  }

  // The same three edits as the desktop patch: QuestStore only ever keeps the server's "nothing for
  // you" answers, so the quest bar, promos and quest cards have nothing to show.
  function emptyQuestStore(handlers) {
    var copy = Object.assign({}, handlers);
    var ok = [
      // GET /quests/@me: no current quests, no excluded quests.
      wrapHandler(copy, 'QUESTS_FETCH_CURRENT_QUESTS_SUCCESS', function (original, args) {
        args[0] = Object.assign({}, args[0], { quests: [], excludedQuests: [] });
        return original.apply(this, args);
      }),
      // POST /quests/decision: nothing to deliver (no state change).
      wrapHandler(copy, 'QUESTS_FETCH_QUEST_TO_DELIVER_SUCCESS', function () {
        return false;
      }),
      // GET /quests/earned-decision: every quest decided as "don't deliver" (id -> null), so the
      // decisions are still cached and the client doesn't keep asking.
      wrapHandler(copy, 'QUESTS_FETCH_EARNED_QUEST_TO_DELIVER_SUCCESS', function (original, args) {
        var serverQuests = (args[0] && args[0].serverQuests) || [];
        args[0] = Object.assign({}, args[0], {
          serverQuests: new Map(
            Array.from(serverQuests, function (entry) {
              return [entry[0], null];
            })
          ),
        });
        return original.apply(this, args);
      }),
    ];
    if (ok.indexOf(false) !== -1) return null;
    return copy;
  }

  // Replaces exports[name] with value. If the exports object won't take it (frozen, or a getter), the
  // module hands out a copy instead: modules look exports up when they use them, not when they load.
  function setExport(moduleObject, name, value) {
    var exports = moduleObject.exports;
    try {
      exports[name] = value;
    } catch (e) {}
    if (exports[name] === value) return;
    var copy = {};
    Object.getOwnPropertyNames(exports).forEach(function (key) {
      try {
        copy[key] = exports[key];
      } catch (e) {}
    });
    copy[name] = value;
    moduleObject.exports = copy;
  }

  function nothing() {
    return null;
  }

  // Ad popups: popup types whose names say they're about quests, Orbs, the Shop, third-party offers or
  // marketing campaigns. The desktop rule plus the mobile-only Orbs (VIRTUAL_CURRENCY), Bounties and
  // wishlist ones. Discord's own feature notices and Nitro upsells are left alone.
  var BLOCKED_POPUPS =
    /(^|_)(QUESTS?|ORBS?|SHOP|COLLECTIBLES|STOREFRONT|3PP?|MARKETING|PROMOS?|BLACK_FRIDAY|DROPS?|VIRTUAL_CURRENCY|BOUNTY|BOUNTIES|WISHLIST)(_|$)/;
  var blockedPopups = new Set();
  var popupNames = {};

  // A popup candidate is a DismissibleContent number, or an entry object holding one in `content`.
  function blocks(candidate) {
    if (candidate && typeof candidate === 'object') candidate = candidate.content;
    return typeof candidate === 'number' && blockedPopups.has(candidate);
  }

  function suppressed(candidate) {
    state.popupsSuppressed[popupNames[candidate && typeof candidate === 'object' ? candidate.content : candidate]] = true;
  }

  var PATCHES = [
    {
      name: 'quest-store-empty',
      why: "QuestStore only ever receives the server's \"nothing for you\" answers",
      path: '../discord_common/js/packages/flux/Dispatcher.tsx',
      apply: function (exports) {
        var Dispatcher = exports && exports.Dispatcher;
        var proto = Dispatcher && Dispatcher.prototype;
        if (!proto || typeof proto.register !== 'function') return 'no Dispatcher.prototype.register';
        var register = proto.register;
        var name = this.name;
        proto.register = function (storeName, handlers) {
          if (storeName === 'QuestStore' && handlers && typeof handlers === 'object') {
            var patched = emptyQuestStore(handlers);
            if (patched) {
              arguments[1] = patched;
              state.applied[name] = 'QuestStore handlers wrapped';
              delete state.waiting[name];
            } else {
              fail(name, 'QuestStore no longer has the expected action handlers');
            }
          }
          return register.apply(this, arguments);
        };
        state.waiting[name] = "QuestStore hasn't registered yet";
        return true;
      },
    },
    {
      // Discord's own switch for quests, which it turns off on Meta Quest headsets: the Quests button
      // on the You screen, the quest dock above the You bar (quests and Bounties), quest promos.
      name: 'quests-hidden',
      why: 'Discord treats this device as not eligible for quests',
      path: 'modules/quests/lib/QuestsEligibility.tsx',
      apply: function (exports, moduleObject) {
        if (typeof exports.getIsEligibleForQuests !== 'function') return 'no getIsEligibleForQuests';
        setExport(moduleObject, 'getIsEligibleForQuests', function getIsEligibleForQuests() {
          return false;
        });
        return true;
      },
    },
    {
      // Discord's own switch for Orbs, also off on Meta Quest: the Orbs Balance card and Orb wallet.
      name: 'orbs-hidden',
      why: 'Discord treats Orbs as unavailable on this device',
      path: 'modules/virtual_currency/hooks/native/useVirtualCurrencyMobileEnabled.tsx',
      apply: function (exports, moduleObject) {
        var hook = exports.useVirtualCurrencyMobileEnabled;
        if (typeof hook !== 'function' || typeof exports.isVirtualCurrencyEnabled !== 'function') {
          return 'no useVirtualCurrencyMobileEnabled/isVirtualCurrencyEnabled';
        }
        setExport(moduleObject, 'useVirtualCurrencyMobileEnabled', function useVirtualCurrencyMobileEnabled() {
          return Object.assign({}, hook.apply(this, arguments), { enabled: false });
        });
        setExport(moduleObject, 'isVirtualCurrencyEnabled', function isVirtualCurrencyEnabled() {
          return false;
        });
        return true;
      },
    },
    {
      // The Shop button in the bar at the bottom of the You screen (the bar always includes it).
      name: 'shop-button',
      why: 'the Shop button on the You screen renders nothing',
      path: 'modules/collectibles/native/CollectiblesShopEntryButton.tsx',
      apply: function (exports, moduleObject) {
        if (!exports.default) return 'no default export';
        setExport(moduleObject, 'default', nothing);
        return true;
      },
    },
    {
      // The Shop row in Settings. The settings list hides a row whose usePredicate() returns false.
      name: 'shop-settings-row',
      why: 'the Shop row in Settings is hidden',
      path: 'modules/user_settings/defs/native/CollectiblesShopSetting.tsx',
      apply: function (exports) {
        var setting = exports.default;
        if (!setting || typeof setting !== 'object' || typeof setting.getComponent !== 'function') {
          return 'no setting definition';
        }
        var hidden = function () {
          return false;
        };
        try {
          setting.usePredicate = hidden;
        } catch (e) {}
        return setting.usePredicate === hidden || 'setting definition is read-only';
      },
    },
    {
      // Reads the names of Discord's popup types to tell which are ads (changes nothing).
      name: 'popup-catalogue',
      why: "reads Discord's popup types to find the ad ones",
      path: '../discord_common/js/packages/protos/discord_protos/discord_users/v1/dismissible_content.tsx',
      apply: function (exports) {
        var types = exports.DismissibleContent;
        if (!types || typeof types !== 'object') return 'no DismissibleContent';
        Object.keys(types).forEach(function (name) {
          var id = types[name];
          if (typeof id !== 'number') return;
          popupNames[id] = name;
          if (BLOCKED_POPUPS.test(name)) blockedPopups.add(id);
        });
        state.popupTypesBlocked = blockedPopups.size;
        return blockedPopups.size > 0 || 'no ad popup types found';
      },
    },
    {
      // Every popup is picked by one of these hooks. They return [content to show, dismiss]. Ad types
      // are left out of the candidates (so another popup can be picked) and never returned, which is
      // the same as if they had already been dismissed. Nothing is saved to your account.
      name: 'popup-gate',
      why: 'ad popups count as already dismissed, so they are never picked to show',
      path: 'modules/dismissible_content/hooks/useSelectedDismissibleContent.tsx',
      apply: function (exports, moduleObject) {
        var names = Object.keys(exports).filter(function (name) {
          return /^useSelected\w*DismissibleContent$/.test(name) && typeof exports[name] === 'function';
        });
        if (names.indexOf('useSelectedDismissibleContent') === -1) return 'no useSelectedDismissibleContent';
        names.forEach(function (name) {
          var hook = exports[name];
          setExport(moduleObject, name, function () {
            var args = Array.prototype.slice.call(arguments);
            if (Array.isArray(args[0])) {
              args[0] = args[0].filter(function (candidate) {
                if (!blocks(candidate)) return true;
                suppressed(candidate);
                return false;
              });
            }
            var result = hook.apply(this, args);
            if (Array.isArray(result) && blocks(result[0])) {
              suppressed(result[0]);
              return [null, result[1]];
            }
            return result;
          });
        });
        return true;
      },
    },
    {
      // Called by every hook above with the content it picked, to record it as shown (that counts
      // towards Discord's daily popup limit). Ad types are passed on as "nothing picked".
      name: 'popup-gate-shown',
      why: 'ad popups are never recorded as shown',
      path: 'modules/dismissible_content/useSelectedDismissibleContentShared.tsx',
      apply: function (exports, moduleObject) {
        var hook = exports.useSelectedDismissibleContentShared;
        if (typeof hook !== 'function') return 'no useSelectedDismissibleContentShared';
        setExport(moduleObject, 'useSelectedDismissibleContentShared', function () {
          var args = Array.prototype.slice.call(arguments);
          if (blocks(args[0])) args[0] = null;
          return hook.apply(this, args);
        });
        return true;
      },
    },
    {
      // The same for code that asks "has the user dismissed this?" directly.
      name: 'popup-gate-legacy',
      why: 'code that asks directly whether an ad popup was dismissed is told it was',
      path: 'modules/dismissible_content/DismissibleContentUnsafeUtils.tsx',
      apply: function (exports, moduleObject) {
        var check = exports.UNSAFE_isDismissibleContentDismissed;
        var hook = exports.useIsDismissibleContentDismissed_UNSAFE;
        if (typeof check !== 'function' || typeof hook !== 'function') {
          return 'no UNSAFE_isDismissibleContentDismissed/useIsDismissibleContentDismissed_UNSAFE';
        }
        setExport(moduleObject, 'UNSAFE_isDismissibleContentDismissed', function (content) {
          if (blocks(content)) return true;
          return check.apply(this, arguments);
        });
        setExport(moduleObject, 'useIsDismissibleContentDismissed_UNSAFE', function (content) {
          var dismissed = hook.apply(this, arguments); // still called: it's a React hook
          return blocks(content) ? true : dismissed;
        });
        return true;
      },
    },
  ];

  var patchesByPath = {};
  PATCHES.forEach(function (patch) {
    (patchesByPath[patch.path] = patchesByPath[patch.path] || []).push(patch);
  });

  function applyPatches(path, moduleObject) {
    var patches = patchesByPath[path];
    if (!patches) return;
    scheduleReport();
    for (var i = 0; i < patches.length; i++) {
      var patch = patches[i];
      try {
        var result = patch.apply.call(patch, moduleObject.exports, moduleObject);
        if (result === true) {
          if (!state.applied[patch.name] && !state.waiting[patch.name]) state.applied[patch.name] = true;
        } else {
          fail(patch.name, result || 'unexpected shape');
        }
      } catch (e) {
        fail(patch.name, 'threw: ' + e);
        error(patch.name, e);
      }
    }
  }

  // -- Module system hook ----------------------------------------------------------------------

  var initializing = []; // ids of the modules whose factories are running (they nest through require)
  var pathOf = {}; // module id -> source path
  var trackerHooked = false;

  // The module that collects import timings exports fileFinishedImporting(path); every module calls
  // it with its own source path at the end of its factory, while it is the innermost running factory.
  function hookTracker(moduleObject) {
    var exports = moduleObject.exports;
    var original = exports.fileFinishedImporting;
    var wrapped = function (path) {
      if (initializing.length && typeof path === 'string') {
        pathOf[initializing[initializing.length - 1]] = path;
        state.paths++;
      }
      return original.apply(this, arguments);
    };
    try {
      exports.fileFinishedImporting = wrapped;
    } catch (e) {}
    if (exports.fileFinishedImporting !== wrapped) {
      // Frozen or a getter: hand out a copy instead (modules look it up on each call).
      moduleObject.exports = Object.assign({}, exports, { fileFinishedImporting: wrapped });
    }
    trackerHooked = true;
  }

  function wrapFactory(factory, id) {
    return function (global, require, importDefault, importAll, moduleObject) {
      initializing.push(id);
      try {
        return factory.apply(this, arguments);
      } finally {
        initializing.pop();
        state.modules++;
        try {
          var exports = moduleObject && moduleObject.exports;
          if (!trackerHooked && exports && typeof exports.fileFinishedImporting === 'function') {
            hookTracker(moduleObject);
          }
          var path = pathOf[id];
          if (path !== undefined) {
            delete pathOf[id];
            applyPatches(path, moduleObject);
          }
        } catch (e) {
          error('module ' + id, e);
        }
      }
    };
  }

  // Metro's prelude assigns its define function to the global `__d`, then every module is defined as
  // __d(factory, moduleId, dependencyMap). Keep the define function, but hand out one that wraps each
  // factory first.
  var define;
  var wrappedDefine = function (factory, id) {
    if (typeof factory === 'function') {
      try {
        arguments[0] = wrapFactory(factory, id);
      } catch (e) {
        error('define ' + id, e);
      }
    }
    return define.apply(this, arguments);
  };
  Object.defineProperty(globalThis, '__d', {
    configurable: true,
    get: function () {
      return define && wrappedDefine;
    },
    set: function (value) {
      define = value;
      state.hooked = true;
    },
  });

  // -- Status ----------------------------------------------------------------------------------

  function report() {
    var copy = JSON.parse(JSON.stringify(state));
    PATCHES.forEach(function (patch) {
      if (!copy.applied[patch.name] && !copy.missed[patch.name] && !copy.waiting[patch.name]) {
        copy.waiting[patch.name] = "its part of Discord hasn't loaded yet: " + patch.path;
      }
    });
    return copy;
  }

  function toast(message) {
    try {
      var proxy = globalThis.__turboModuleProxy;
      var toastModule =
        (typeof proxy === 'function' && proxy('ToastAndroid')) ||
        (globalThis.nativeModuleProxy && globalThis.nativeModuleProxy.ToastAndroid);
      if (toastModule && typeof toastModule.show === 'function') toastModule.show(message, 1);
    } catch (e) {}
  }

  // Report once Discord has had time to start (timers exist by the time Discord's modules run).
  // Startup report, once Discord has had time to start (timers exist by the time Discord's modules
  // run). Patches for screens that haven't been opened yet are still waiting; that's not a failure.
  // It's logged, and only shown when a patch didn't apply (Discord changed what it patches), so it's
  // clear why that part of Discord is back. A patch that fails later says so when it fails.
  var reported = false;
  var startupReportShown = false;
  function scheduleReport() {
    if (reported || typeof setTimeout !== 'function') return;
    reported = true;
    setTimeout(function () {
      startupReportShown = true;
      var status = report();
      var failed = Object.keys(status.missed);
      log('status', JSON.stringify(status));
      if (failed.length) toast('de-enshittify ' + VERSION + ": didn't apply: " + failed.join(', '));
    }, 15000);
  }
  globalThis.__deEnshittifyDiscord = { version: VERSION, report: report, patches: PATCHES };
  log('loaded', VERSION);
})();
