// ================================================
// globals.d.ts — what this app hangs off `window`
// ================================================
// Types only. Nothing here is loaded, bundled or served; it exists so
// `tsc --noEmit -p jsconfig.json` understands the module pattern this app uses —
// nine IIFEs that each assign one object to `window`.
//
// WHY THESE ARE `any`, and what that costs:
//
// A namespace here is a plain object literal built inside a closure. There is no
// declaration to point at, so typing them properly would mean hand-maintaining a
// second copy of every module's public surface — which would rot, silently, and be
// worse than nothing.
//
// So the checking that matters lives on the FUNCTIONS instead: `@param {Med}`,
// `@returns {Dose[]}` and friends in js/types.js. Those catch the mistakes that
// have actually happened here (a med where a dose was meant, hours where days were
// meant). `window.Store.foo` being untyped catches nothing, because a typo there
// fails loudly on the first click anyway.

declare global {
    interface Window {
        /** data.js — pure functions, presets, formatting, pharmacokinetics. */
        MedData: any;
        /** store.js — state, persistence, sync, and every destructive mutation. */
        Store: any;
        /** ui.js — icons, DOM helpers, the modal and toast framework. */
        UI: any;
        /** charts.js — hand-rolled SVG charts. */
        Charts: any;
        /** views.js — every rendered page. */
        Views: any;
        /** The five modals-*.js files, which all assign into this one object. */
        Modals: any;
        /** onboarding.js — first-run flow and v1/v2 import. */
        Onboarding: any;
        /** app.js — routing, the delegated click handler, render. */
        App: any;
        /** push.js — web push subscription. */
        Push: any;

        /** /sync-wip.js and /sync.js. sync.js sets BOTH names, so this one always works. */
        SyncWip: any;
        /** Set by /sync.js only. Prefer SyncWip, which exists on both. */
        Sync: any;
        /** /auth-wip.js */
        AuthManagerWip: any;
        /** /auth.js */
        AuthManager: any;

        /** 'live' | 'wip' — read by views.js to show the WIP-only dev controls. */
        MED_ENVIRONMENT: string;
    }

    // The same names again, unqualified: these files say `SyncWip.SyncClient`, not
    // `window.SyncWip.SyncClient`.
    var SyncWip: any;
    var Sync: any;
    var AuthManagerWip: any;
    var AuthManager: any;
    var Store: any;
    var MedData: any;
}

export {};
