/* ============================================================
 * config.js — runtime config + shared constants + global state
 * ============================================================ */

const CONFIG = {
  // Pulled from /api/v1/auth/config at startup. Never hard-code it.
  DISCORD_CLIENT_ID: null,
  API_BASE: "https://discord-bot-settings.rosestuffs.org/api/v1",
  REDIRECT_URI: window.location.origin + window.location.pathname,
  STORAGE_KEY: "dbs.user",
};

// Opt-in review harness. Production path is 100% real API; demo only activates
// with ?demo=1 in the URL (or a stored flag), so the live server is unaffected.
const DEMO = (() => {
  const p = new URLSearchParams(window.location.search);
  if (p.get("demo") === "1") { try { localStorage.setItem("dbs.demo", "1"); } catch {} return true; }
  if (p.get("demo") === "0") { try { localStorage.removeItem("dbs.demo"); } catch {} return false; }
  try { return localStorage.getItem("dbs.demo") === "1"; } catch { return false; }
})();

const TEMPLATE_KIND_LABEL = {
  mission_dm: "Mission DM",
  reminder_dm: "Reminder DM",
  rsvp_summary: "RSVP summary",
  announcement: "Announcement",
  freeform: "Freeform embed",
};

const REMINDER_MAX_MINUTES = 30240; // 21 days

const state = {
  user: null,            // {user_id, username, avatar, tracker_token}
  bots: [],
  guilds: [],
  selectedBot: null,
  selectedGuild: null,
  activeTab: "settings",
  ready: false,          // context (bots+guilds) loaded
  pendingLoad: false,    // bug B: a tab load requested before ready

  // settings
  pendingSettings: null,
  detectionRules: [],
  modlist: {},
  templatesAllCache: null,
  templatesAllCacheGuild: null,

  // missions
  missionsState: "upcoming",
  drawerMission: null,

  // templates
  templatesKind: "mission_dm",
  templates: [],
  roleBindings: [],
  editingTemplate: null,
  rolesCache: [],
  previewContextKey: "default",
  previewFraming: "dm",

  // compose
  channelsCache: [],
  composeRoleIds: [],

  // status
  armaServer: null,
};

// element cache, populated on load
const els = {};
