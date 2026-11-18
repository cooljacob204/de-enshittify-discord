// de-enshittify-discord, renderer side. Runs in Discord's page (main world) before any of Discord's own
// scripts. It hooks the webpack runtime's module table and rewrites the source of a few specific
// modules before they first run:
//
//   - the QuestStore only ever sees "no quests for you" responses, so the quest bar, member-list and
//     activity-panel promos, profile quest cards and gift-inventory quests have nothing to render;
//   - the Shop and Quests rows in the DM sidebar are never created;
//   - the Discover page's Quests tab is filtered out;
//   - quest share links in chat are no longer turned into quest embeds (they stay plain links).
//
// Each patch is all-or-nothing. If Discord's code changes so a patch no longer matches, that module
// is left exactly as Discord shipped it and the miss is reported (devtools console, and status.json
// next to this file), so a stale patch brings the feature back rather than breaking the client.
(() => {
  'use strict';
  if (globalThis.__deEnshittifyDiscord) return;

  // Popup, coachmark, badge and banner types (Discord's DismissibleContent enum) that are ads: quests,
  // Orbs (also VIRTUAL_CURRENCY), Bounties, the Shop, wishlists and game storefronts, third-party
  // partner offers ("3P") and partner games' account link promos, marketing campaigns and promos.
  // Matched by name, so new campaigns with these words are caught too. The same rules as the Android
  // patch (android/patches/src/main/resources/de-enshittify-discord.js).
  const BLOCKED_POPUPS =
    /(^|_)(QUESTS?|ORBS?|SHOP|COLLECTIBLES|STOREFRONT|3PP?|MARKETING|PROMOS?|BLACK_FRIDAY|DROPS?|VIRTUAL_CURRENCY|BOUNTY|BOUNTIES|WISHLIST)(_|$)/;
  const PARTNER_GAME_PROMOS = /^(?!GAME_).*_ACCOUNT_LINK_UPSELL$/;
  // Nitro upsells: promos for Nitro, Nitro-only features such as display name styles, trials, server
  // boosts and power-ups, paid server subscriptions, potions, gifting promos and referral or discount
  // offers. Popups for free features (AutoMod, forum channels, voice messages, passkeys...) aren't,
  // and neither are notices about your own subscription (trial ending, reactivate).
  const NITRO_UPSELLS =
    /(^|_)(NITRO|PREMIUM|TRIALS?|POTION|BOGO|REFERRAL|DISCOUNT|PERMADECOS|POWERUP|BOOSTS?|BOOSTING|GIFTING_PROMOTION|ROLE_SUBSCRIPTION|SERVER_SUBSCRIPTION|CREATOR_MONETIZATION|MONTHLY_TO_YEARLY|FREE_USER)(_|$)|^DISPLAY_NAME_STYLES/;
  const SUBSCRIPTION_NOTICES = /^NAGBAR_NOTICE_PREMIUM_(TIER_\w+_TRIAL_ENDING|REACTIVATE)$/;
  const isBlockedPopup = (name) =>
    BLOCKED_POPUPS.test(name) ||
    PARTNER_GAME_PROMOS.test(name) ||
    (NITRO_UPSELLS.test(name) && !SUBSCRIPTION_NOTICES.test(name));
  const popupNames = new Map(); // enum value -> name, read from the enum module's source
  const blockedPopupIds = new Set();
  const suppressed = new Set(); // names actually asked about (and refused) this session

  function blocks(id) {
    if (!blockedPopupIds.has(id)) return false;
    suppressed.add(popupNames.get(id));
    return true;
  }

  // Replacement for a route's `render:X`: a redirect built from the same Redirect component Discord
  // uses for its own deprecated quests URL in that module. If that can't be found, the route is left
  // alone (the patch reports as not matching).
  const redirectTo = (target) => (match, prefix, offset, whole) => {
    const r = /\.QUEST_HOME_DEPRECATED,render:[\w$]+=>\{let\{location:[\w$]+\}=[\w$]+;return\(0,([\w$]+)\.jsx\)\(([\w$]+\.[\w$]+),\{to:\{pathname:/.exec(whole);
    return r ? `${prefix}()=>(0,${r[1]}.jsx)(${r[2]},{to:${JSON.stringify(target)}})` : match;
  };

  const PATCHES = [
    {
      name: 'quest-store-empty',
      why: 'QuestStore only ever receives the server\'s "nothing for you" answers',
      find: 'static displayName="QuestStore"',
      replace: [
        // GET /quests/@me: no current quests, no excluded quests.
        {
          match: /(QUESTS_FETCH_CURRENT_QUESTS_SUCCESS:function\(([\w$]+)\)\{)/,
          with: '$1$2={...$2,quests:[],excludedQuests:[]};',
        },
        // POST /quests/decision: nothing to deliver (the store's own early return for a null quest).
        {
          match: /(QUESTS_FETCH_QUEST_TO_DELIVER_SUCCESS:function\([\w$]+\)\{)/,
          with: '$1return!1;',
        },
        // GET /quests/earned-decision: every quest decided as "don't deliver" (id -> null), so the
        // decisions are still cached and the client doesn't keep re-asking.
        {
          match: /(QUESTS_FETCH_EARNED_QUEST_TO_DELIVER_SUCCESS:function\(([\w$]+)\)\{)/,
          with: '$1$2={...$2,serverQuests:new Map(Array.from($2.serverQuests??[],([q])=>[q,null]))};',
        },
      ],
    },
    {
      name: 'dm-sidebar-shop',
      why: 'the Shop row in the DM sidebar is never created',
      find: '"discord-shop"',
      replace: [
        {
          match: /(\(0,[\w$]+\.jsxs?\)\([\w$]+,\{selected:[\w$]+\.startsWith\([\w$]+\.[\w$]+\.COLLECTIBLES_SHOP\))/,
          with: '!1&&$1',
        },
      ],
    },
    {
      name: 'dm-sidebar-quests',
      why: 'the Quests row in the DM sidebar is never created',
      find: '"discord-shop"',
      replace: [
        {
          match: /(\(0,[\w$]+\.jsxs?\)\([\w$]+,\{selected:[\w$]+\.startsWith\([\w$]+\.[\w$]+\.QUEST_HOME\)\},"quests"\))/,
          with: '!1&&$1',
        },
      ],
    },
    {
      name: 'discover-quests-tab',
      why: 'the Discover sidebar always filters out its Quests tab',
      find: 'location:"GlobalDiscoverySidebar"',
      replace: [
        {
          match: /([\w$]+)!==([\w$]+)\.GlobalDiscoveryTab\.QUESTS\|\|![\w$]+/,
          with: '$1!==$2.GlobalDiscoveryTab.QUESTS',
        },
      ],
    },
    {
      name: 'startup-quest-redirect',
      why: 'opening Discord never redirects to the Quests page',
      find: '"SessionRedirector"',
      replace: [
        {
          match: /if\((\(0,[\w$]+\.[\w$]+\)\("SessionRedirector"\))\)return/,
          with: 'if(!1&&$1)return',
        },
      ],
    },
    {
      name: 'quest-page-route',
      why: 'the Quests page redirects to your DMs (a remembered last page, old links)',
      find: '.QUEST_HOME_DEPRECATED,render:',
      replace: [{ match: /(path:[\w$]+\.[\w$]+\.QUEST_HOME,render:)[\w$]+/, with: redirectTo('/channels/@me') }],
    },
    {
      name: 'shop-page-route',
      why: 'the Shop page redirects to your DMs ("visit the shop" buttons elsewhere)',
      find: '.QUEST_HOME_DEPRECATED,render:',
      replace: [
        {
          match: /(path:\[[^\]]*?[\w$]+\.[\w$]+\.COLLECTIBLES_SHOP\],render:)[\w$]+/,
          with: redirectTo('/channels/@me'),
        },
      ],
    },
    {
      name: 'popup-catalogue',
      why: 'reads the names of Discord\'s popup types, to tell which are ads (changes nothing)',
      find: ']="MACARON_3P_POPOVER"',
      observe(src) {
        for (const m of src.matchAll(/\[[\w$]+\.([A-Z0-9_]+)=(\d+)\]="\1"/g)) {
          const id = Number(m[2]);
          popupNames.set(id, m[1]);
          if (isBlockedPopup(m[1])) blockedPopupIds.add(id);
        }
        return blockedPopupIds.size > 0;
      },
    },
    {
      name: 'popup-gate',
      why: 'ad popups count as already dismissed, so they are never picked to show (nothing is saved to your account)',
      find: 'let{dismissedContents:',
      replace: [
        {
          match: /(:function\(([\w$]+),[\w$]+,[\w$]+\)\{)(var [\w$,]+;let\{dismissedContents:)/,
          with: '$1if(globalThis.__deEnshittifyDiscord?.blocks($2?.content))return!1;$3',
        },
      ],
    },
    {
      name: 'popup-gate-legacy',
      why: 'the same for code that asks "has the user dismissed this?" directly',
      find: 'bypassNewUserCheck:t=',
      replace: [
        {
          match: /(function [\w$]+\(([\w$]+)\)\{)(let\{bypassNewUserCheck:)/,
          with: '$1if(globalThis.__deEnshittifyDiscord?.blocks($2))return!0;$3',
        },
      ],
    },
    {
      name: 'quest-link-embeds',
      why: 'discord.com/quests/<id> links are no longer recognised, so they stay plain links',
      find: '/^\\/quests\\/([0-9-]+)\\/?$/',
      replace: [{ match: '/^\\/quests\\/([0-9-]+)\\/?$/', with: '/(?!)/' }],
    },
  ];

  const TAG = '[de-enshittify-discord]';
  const fnToString = Function.prototype.toString;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const state = { runtimes: [], applied: {}, missed: {}, errors: [] };
  const ours = new WeakSet();

  function log(level, ...args) {
    try {
      console[level](TAG, ...args);
    } catch {}
  }

  // Module factories can be object-method shorthand ("123(e,t,n){...}"), which isn't an expression.
  function toExpression(code) {
    if (/^(?:async\s+)?function\b/.test(code)) return code;
    if (/^(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.test(code)) return code;
    return 'function' + code.slice(code.indexOf('('));
  }

  function patchFactory(factory, id) {
    if (typeof factory !== 'function' || ours.has(factory)) return factory;
    let src;
    try {
      src = fnToString.call(factory);
    } catch {
      return factory;
    }
    let code = src;
    const used = [];
    for (const patch of PATCHES) {
      if (!src.includes(patch.find)) continue;
      if (patch.observe) {
        let ok = false;
        try {
          ok = patch.observe(src);
        } catch {}
        if (ok) state.applied[patch.name] = String(id);
        else state.missed[patch.name] = { module: String(id), step: 0 };
        continue;
      }
      let next = code;
      const failedStep = patch.replace.findIndex((r) => {
        const out = next.replace(r.match, r.with);
        if (out === next) return true;
        next = out;
        return false;
      });
      if (failedStep === -1) {
        code = next;
        used.push(patch.name);
      } else {
        state.missed[patch.name] = { module: String(id), step: failedStep };
        log('warn', `${patch.name}: found module ${id} but replacement #${failedStep} no longer matches; left unpatched`);
      }
    }
    if (!used.length) return factory;
    try {
      const fn = (0, eval)(`(${toExpression(code)})\n//# sourceURL=de-enshittify-discord/module-${id}.js`);
      ours.add(fn);
      for (const name of used) state.applied[name] = String(id);
      return fn;
    } catch (e) {
      state.errors.push({ module: String(id), patches: used, error: String(e) });
      log('error', `module ${id} did not compile after ${used.join(', ')}; using Discord's original`, e);
      return factory;
    }
  }

  // Patch anything added to the table later (lazy-loaded chunks).
  function wrap(table) {
    return new Proxy(table, {
      set(target, key, value) {
        target[key] = patchFactory(value, key);
        return true;
      },
    });
  }

  function isWebpackRequire(fn) {
    try {
      const s = fnToString.call(fn);
      return s.length < 1000 && s.includes('exports') && s.includes('.call(');
    } catch {
      return false;
    }
  }

  // Each webpack/rspack runtime does `__webpack_require__.m = modules` once, before any of its modules
  // run. The page has several runtimes (small bundles such as fast-connect load before the main
  // web.js), so this stays installed and hooks every one of them. On a hit it patches the initial
  // modules in place, then keeps our proxy as the outermost layer: another client mod (BetterDiscord)
  // later wraps `.m` in its own proxy, and re-wrapping on every assignment means we still see
  // Discord's original factories, not its wrappers. Any other `fn.m = x` gets a plain property, as
  // it would have without this.
  Object.defineProperty(Function.prototype, 'm', {
    configurable: true,
    set(table) {
      const req = this;
      if (!table || typeof table !== 'object' || !isWebpackRequire(req)) {
        Object.defineProperty(req, 'm', { value: table, writable: true, configurable: true, enumerable: true });
        return;
      }
      const t0 = now();
      const ids = Object.keys(table);
      for (const id of ids) {
        const original = table[id];
        const result = patchFactory(original, id);
        if (result !== original) table[id] = result;
      }
      state.runtimes.push({ modules: ids.length, ms: Math.round(now() - t0) });
      let current = wrap(table);
      Object.defineProperty(req, 'm', {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (next) => {
          current = wrap(next);
        },
      });
    },
  });

  function report() {
    const names = PATCHES.map((p) => p.name);
    return {
      hooked: state.runtimes.length > 0,
      runtimes: state.runtimes,
      applied: state.applied,
      missed: state.missed,
      notFound: names.filter((n) => !(n in state.applied) && !(n in state.missed)),
      errors: state.errors,
      popupTypesBlocked: blockedPopupIds.size,
      popupsSuppressed: [...suppressed].sort(),
      buildId: globalThis.GLOBAL_ENV?.SENTRY_TAGS?.buildId ?? null,
      at: new Date().toISOString(),
    };
  }

  globalThis.__deEnshittifyDiscord = { report, blocks, patches: PATCHES.map(({ name, why }) => ({ name, why })) };

  // Once the client has settled, log the result and hand it to the preload, which writes status.json.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof setTimeout === 'function') {
    window.addEventListener(
      'load',
      () =>
        setTimeout(() => {
          const r = report();
          const ok = r.hooked && !r.notFound.length && !Object.keys(r.missed).length && !r.errors.length;
          log(ok ? 'log' : 'warn', ok ? 'all patches applied' : 'some patches did not apply', r);
          try {
            window.postMessage({ type: 'de-enshittify-discord:status', status: r }, location.origin);
          } catch {}
        }, 20000),
      { once: true },
    );
  }
})();
