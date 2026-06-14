/* ============================================================
 * data.js — mock armaState for the prototype.
 * Shapes mirror the §03 data-model so the UI maps to real rows.
 * ============================================================ */

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;

const armaState = {
  guildName: "Rosie's Arma Unit",
  serverName: "Arma3 · Main",

  /* which review scenario the active-armaState strip reflects */
  scenario: "none", // 'none' | 'live' | 'drift'

  /* live server snapshots per scenario (what /arma-armaState would return).
     armaState.server is the mutable "current" snapshot; presets seed it. */
  scenarios: {
    none: {
      power: "running", label: "Online", badge: "running",
      mission_pretty: "Sandbox", mission_pbo: "Sandbox.Altis.pbo", map: "Altis",
      players: 0, players_max: 64, uptime_from: iso(12 * MIN),
      active_modlist_id: null, active_loadout_id: null, active_event_id: null,
      boot_pending: null, drift: false, drift_expected_pbo: null,
    },
    live: {
      power: "running", label: "Online", badge: "running",
      mission_pretty: "Op Iron Shield", mission_pbo: "Op_Iron_Shield.Altis.pbo", map: "Altis",
      players: 4, players_max: 64, uptime_from: iso(2 * HOUR + 14 * MIN),
      active_modlist_id: 2, active_loadout_id: 1, active_event_id: 18,
      boot_pending: null, drift: false, drift_expected_pbo: null,
    },
    drift: {
      power: "running", label: "Online", badge: "running",
      mission_pretty: "Op Heli-Ops", mission_pbo: "Op_Heli_Ops.Altis.pbo", map: "Altis",
      players: 2, players_max: 64, uptime_from: iso(38 * MIN),
      active_modlist_id: 2, active_loadout_id: 1, active_event_id: 18,
      boot_pending: null, drift: true, drift_expected_pbo: "Op_Iron_Shield.Altis.pbo",
    },
  },
  server: null, // seeded below from scenarios.none

  /* modlists (library) — §03 modlists table */
  modlists: [
    { id: 1, name: "Vietnam Pack",   description: "SOG PF, CUP terrains, unsung core", html_bytes: 47 * 1024, source: "channel", source_ref: "#modlist · msg 1182", updated_at: iso(3 * DAY) },
    { id: 2, name: "Modern Gear",    description: "RHS USAF/AFRF + ACE3 + ACRE2",       html_bytes: 62 * 1024, source: "channel", source_ref: "#modlist · msg 1207", updated_at: iso(5 * DAY) },
    { id: 3, name: "Sandbox Vanilla",description: "CBA only — open testing",            html_bytes: 8 * 1024,  source: "upload",  source_ref: "vanilla_export.html", updated_at: iso(15 * DAY) },
    { id: 4, name: "ACE + RHS Core", description: "Shared base for most ops",            html_bytes: 38 * 1024, source: "upload",  source_ref: "core_v4.html",       updated_at: iso(34 * DAY) },
    { id: 5, name: "Captured (legacy)", description: "Migrated from v1 single-slot cache", html_bytes: 24 * 1024, source: "channel", source_ref: "v1 migration", updated_at: iso(70 * DAY) },
  ],

  /* installed PBOs on /mpmissions (Server status tab) */
  installedMissions: [
    "Sandbox.Altis.pbo",
    "Op_Iron_Shield.Altis.pbo",
    "Vietnam_HeliOps.Tanoa.pbo",
    "Op_Heli_Ops.Altis.pbo",
    "ColdFront.Livonia.pbo",
    "Antistasi.Tanoa.pbo",
  ],

  /* loadouts — §03 loadouts table. status is derived for display:
     'active' (live event on it) | 'paused' (paused event) | 'inactive' */
  loadouts: [
    { id: 1, name: "Op Iron Shield", description: "Modern combined-arms assault on Altis. Our flagship Saturday op.",
      mission_pbo: "Op_Iron_Shield.Altis.pbo", modlist_id: 2, is_default: false,
      last_run: iso(3 * DAY), archived: false },
    { id: 2, name: "Vietnam Heli-Ops", description: "SOG Prairie Fire helicopter insertions over Tanoa. Multi-day campaign.",
      mission_pbo: "Vietnam_HeliOps.Tanoa.pbo", modlist_id: 1, is_default: false,
      last_run: iso(1 * DAY), archived: false, paused_event_id: 16 },
    { id: 3, name: "Sandbox Vanilla", description: "Open testing playground. The server's default boot mission.",
      mission_pbo: "Sandbox.Altis.pbo", modlist_id: null, is_default: true,
      last_run: iso(12 * MIN), archived: false },
    { id: 4, name: "Op Cold Front", description: "Winter Livonia push. Built but never run yet — needs a play-test.",
      mission_pbo: "ColdFront.Livonia.pbo", modlist_id: 2, is_default: false,
      last_run: null, archived: false },
    { id: 5, name: "Antistasi Tanoa", description: "Persistent guerrilla campaign. Long-running, save-heavy.",
      mission_pbo: "Antistasi.Tanoa.pbo", modlist_id: 4, is_default: false,
      last_run: iso(16 * DAY), archived: false },
  ],

  /* events — §03 events table + per-event action log for the timeline */
  events: [
    {
      id: 16, loadout_id: 2, started_at: iso(2 * DAY + 3 * HOUR), last_active_at: iso(1 * DAY + 4 * HOUR),
      paused_at: iso(1 * DAY + 4 * HOUR), paused_snapshot: { save_dir: "/_arma_saves/event_16/", active_modlist_id: 1, files: 7 },
      ended_at: null, ended_reason: null, notes: "Paused after session 1 — resume Thu.",
      actions: [
        { t: "swap",   at: iso(2 * DAY + 3 * HOUR), text: "Loadout swap: Sandbox → Vietnam Heli-Ops (with restart)", payload: "modlist → Vietnam Pack (47 KB)\nboot mission → Vietnam_HeliOps.Tanoa.pbo\npower: restart" },
        { t: "pause",  at: iso(1 * DAY + 4 * HOUR), text: "Event paused — save snapshot at /_arma_saves/event_16/", payload: "copied 7 save files\nclass Missions {} snapshotted\nactive modlist: Vietnam Pack" },
      ],
    },
    {
      id: 15, loadout_id: 1, started_at: iso(3 * DAY + 5 * HOUR), last_active_at: iso(3 * DAY + 1 * HOUR),
      paused_at: null, paused_snapshot: null, ended_at: iso(3 * DAY + 1 * HOUR), ended_reason: "manual",
      notes: "", actions: [
        { t: "swap",   at: iso(3 * DAY + 5 * HOUR), text: "Loadout swap: Sandbox → Op Iron Shield (with restart)", payload: "modlist → Modern Gear (62 KB)\nboot mission → Op_Iron_Shield.Altis.pbo\npower: restart" },
        { t: "drift",  at: iso(3 * DAY + 3 * HOUR), text: "Drift detected: live PBO ≠ event loadout", payload: "live: Op_Heli_Ops.Altis.pbo\nexpected: Op_Iron_Shield.Altis.pbo\nresolved: reconciled to live" },
        { t: "end",    at: iso(3 * DAY + 1 * HOUR), text: "Event ended — reason: manual", payload: "duration 4h 02m · 11 players peak" },
      ],
    },
    {
      id: 14, loadout_id: 5, started_at: iso(16 * DAY), last_active_at: iso(15 * DAY + 18 * HOUR),
      paused_at: null, paused_snapshot: null, ended_at: iso(15 * DAY + 18 * HOUR), ended_reason: "long_idle",
      notes: "", actions: [
        { t: "swap", at: iso(16 * DAY), text: "Loadout swap: Sandbox → Antistasi Tanoa (config only)", payload: "modlist → ACE + RHS Core (38 KB)\nboot mission → Antistasi.Tanoa.pbo\npower: no restart" },
        { t: "end",  at: iso(15 * DAY + 18 * HOUR), text: "Event ended — reason: long_idle (auto)", payload: "no players for 6h · auto-ended by heuristic" },
      ],
    },
  ],

  nextEventId: 19,
  nextLoadoutId: 6,
  nextModlistId: 6,

  /* settings.active_modlist_id (none active in the default scenario) */
  activeModlistId: null,

  /* discord channels for pickers (strings — never Number() a snowflake) */
  channels: [
    { id: "1182004411210000001", name: "modlist" },
    { id: "1182004411210000002", name: "ops-announce" },
    { id: "1182004411210000003", name: "server-status" },
  ],
};

/* lookups */
function modlistById(id) { return armaState.modlists.find((m) => m.id === id) || null; }
function loadoutById(id) { return armaState.loadouts.find((l) => l.id === id) || null; }
function eventById(id) { return armaState.events.find((e) => e.id === id) || null; }
function liveSnap() { return armaState.server; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* the canonical "live" event used by the live/drift demo scenarios */
function makeLiveEvent18() {
  return {
    id: 18, loadout_id: 1, started_at: iso(2 * HOUR + 14 * MIN), last_active_at: iso(2 * MIN),
    paused_at: null, paused_snapshot: null, ended_at: null, ended_reason: null,
    notes: "", actions: [
      { t: "swap", at: iso(2 * HOUR + 14 * MIN), text: "Loadout swap: Sandbox → Op Iron Shield (with restart)",
        payload: "modlist → Modern Gear (62 KB)\nboot mission → Op_Iron_Shield.Altis.pbo\npower: restart" },
    ],
  };
}

/* seed the mutable server snapshot */
armaState.server = clone(armaState.scenarios.none);

/* swap the demo scenario (review aid). Clears any prototype-created live
   events, then for live/drift injects the canonical event #18. */
function setScenario(name) {
  armaState.scenario = name;
  armaState.server = clone(armaState.scenarios[name]);
  // drop any currently-live event objects (prototype resets cleanly)
  armaState.events = armaState.events.filter((e) => e.paused_at || e.ended_at);
  if (name === "live" || name === "drift") {
    const ev = makeLiveEvent18();
    if (name === "drift") {
      ev.actions.push({ t: "drift", at: iso(38 * MIN), text: "Drift detected: live PBO ≠ event loadout",
        payload: "live: Op_Heli_Ops.Altis.pbo\nexpected: Op_Iron_Shield.Altis.pbo" });
    }
    armaState.events.unshift(ev);
  }
}

/* derive a loadout's display status from the live server. Paused
 * concept removed 2026-06 — see plan/so-we-need-to-zesty-sunbeam. */
function loadoutStatus(ld) {
  const snap = armaState.server;
  if (snap.active_loadout_id === ld.id && snap.active_event_id) {
    const ev = eventById(snap.active_event_id);
    if (!ev || !ev.ended_at) return "active";
  }
  return "inactive";
}

/* the single live (running, not paused/ended) event, if any */
function liveEvent() {
  const id = armaState.server.active_event_id;
  if (!id) return null;
  const ev = eventById(id);
  return ev && !ev.paused_at && !ev.ended_at ? ev : null;
}
