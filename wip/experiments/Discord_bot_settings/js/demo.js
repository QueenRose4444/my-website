/* ============================================================
 * demo.js — OPT-IN review harness (only active with ?demo=1)
 * Mirrors 07-sample-data.json + simulates mutations in memory so
 * the full UI can be clicked through without the live backend.
 * The production code path never touches this unless DEMO === true.
 * ============================================================ */

const DEMO_DB = {
  auth: {
    user_id: "123456789012345678",
    username: "queenrose4444",
    avatar: null,
    tracker_token: "demo_tracker_token",
    manageable_count: 2,
  },
  bots: [{ name: "arma3-testing", label: "Arma3 (testing)" }],
  guilds: [
    { guild_id: "855675560902262785", name: "ARMA3", icon: null, bot_name: "arma3-testing", bot_label: "Arma3 (testing)" },
    { guild_id: "144144144144144144", name: "Important stuff", icon: null, bot_name: "arma3-testing", bot_label: "Arma3 (testing)" },
  ],
  settings: {
    self_notify: false,
    default_opt_in: true,
    default_reminders: "60,30",
    default_timezone: "Etc/GMT-8",
    rsvp_channel_id: 1234567890123456789,
    modlist_channel_id: 1234567890123456794,
  },
  monitored_roles: [
    { id: "922302344031526933", name: "ARMA III", color: 3447003 },
    { id: "1486995648502038578", name: "test dm bot 2", color: 15158332 },
  ],
  available_roles: [
    { id: "855675560902262785", name: "@everyone", color: 0 },
    { id: "922302344031526933", name: "ARMA III", color: 3447003 },
    { id: "1486995648502038578", name: "test dm bot 2", color: 15158332 },
    { id: "988770000000000000", name: "Officers", color: 15844367 },
  ],
  channels: [
    { id: "1234567890123456789", name: "general", type: 0 },
    { id: "1234567890123456790", name: "operations", type: 0 },
    { id: "1234567890123456791", name: "announcements", type: 5 },
    { id: "1234567890123456792", name: "ops-rsvp", type: 0 },
    { id: "1234567890123456794", name: "modlist", type: 0 },
  ],
  detection_rules: [
    { id: 1, guild_id: 855675560902262785, match_text: "MISSION AVAILABLE", template_id: 7, priority: 0, created_at: "2026-05-31T08:00:00+00:00" },
    { id: 2, guild_id: 855675560902262785, match_text: "TRAINING", template_id: 8, priority: 0, created_at: "2026-05-31T08:05:00+00:00" },
    { id: 3, guild_id: 855675560902262785, match_text: "SIDE OPERATION", template_id: 9, priority: 10, created_at: "2026-05-31T08:10:00+00:00" },
  ],
  nextRuleId: 4,
  modlist: {
    channel_id: "1234567890123456794",
    text: "CBA_A3, ACE3, ACRE2, RHSUSAF, RHSAFRF, CUP Terrains Core, CUP Terrains Maps",
    url: "https://cdn.discordapp.com/attachments/1234/Arma3Preset_2026-05-31.html",
    updated_at: "2026-05-31T14:00:00+00:00",
  },
  missions: [
    {
      id: 42, channel_id: "1234567890123456790", message_id: "9876543210987654321",
      author_id: "123456789012345678", role_ids: ["922302344031526933"],
      mission_utc: futureISO(3, 30), raw_content: "@ARMA III\n**⚠MISSION AVAILABLE⚠**\nDate: 16.05.26\nTime: 2030hrs (GMT+8)\n\nAttention @ARMA III,\nInsurgent forces have expanded operations into Kalah Desa, seizing control of key structures and using the area as a staging ground for further activity.\n\n> Objective:\n> Retake Kalah Desa and neutralize insurgent presence.",
      jump_url: "https://discord.com/channels/855675560902262785/1234567890123456790/9876543210987654321",
      created_at: "2026-05-12T08:00:00+00:00", cancelled: false, title: "Operation Kalah Desa",
      template_override_id: 7,
      modlist_url: "https://cdn.discordapp.com/attachments/1234/Arma3Preset_2026-05-31.html",
      modlist_text: "CBA_A3, ACE3, ACRE2, RHSUSAF, RHSAFRF",
      rsvps: { going: ["111","222","333","444"], maybe: ["555","666"], not: ["777"] },
    },
    {
      id: 41, channel_id: "1234567890123456790", message_id: "9876543210987654320",
      author_id: "123456789012345678", role_ids: ["922302344031526933"],
      mission_utc: futureISO(5, 0), raw_content: "@ARMA III\n**SIDE OPERATION**\nDate: 18.05.26\nTime: 2030hrs (GMT+8)\n\nReconnaissance only — no contact.",
      jump_url: "https://discord.com/channels/855675560902262785/1234567890123456790/9876543210987654320",
      created_at: "2026-05-12T09:00:00+00:00", cancelled: false, title: null,
      rsvps: { going: [], maybe: [], not: [] },
    },
    {
      id: 38, channel_id: "1234567890123456790", message_id: "9876543210987654300",
      author_id: "123456789012345678", role_ids: ["922302344031526933"],
      mission_utc: pastISO(6), raw_content: "@ARMA III\n**OPERATION NIGHTFALL**\nNight insertion completed. Outstanding work, operators.",
      jump_url: "https://discord.com/channels/855675560902262785/1234567890123456790/9876543210987654300",
      created_at: "2026-05-01T09:00:00+00:00", cancelled: false, title: "Operation Nightfall",
      rsvps: { going: ["111","222","333","444","888","999"], maybe: ["555"], not: ["777","666"] },
    },
    {
      id: 35, channel_id: "1234567890123456790", message_id: "9876543210987654200",
      author_id: "123456789012345678", role_ids: ["988770000000000000"],
      mission_utc: pastISO(14), raw_content: "@Officers\n**LEADERSHIP BRIEF**\nQuarterly planning session.",
      jump_url: "https://discord.com/channels/855675560902262785/1234567890123456790/9876543210987654200",
      created_at: "2026-04-20T09:00:00+00:00", cancelled: true, title: "Leadership Brief Q2",
      rsvps: { going: ["111","222"], maybe: [], not: [] },
    },
  ],
  templates: [
    { id: 7, guild_id: 855675560902262785, kind: "mission_dm", name: "Default mission DM", is_default: true,
      created_at: "2026-05-12T08:00:00+00:00", updated_at: "2026-05-12T08:00:00+00:00",
      json_blob: { color: "#57f287", title: "🎯 Mission announcement — {server_name}", timestamp: "message",
        fields: [
          { name: "Channel", value: "{channel_name}", inline: true },
          { name: "Role(s)", value: "{role_names}", inline: true },
          { name: "Starts", value: "{mission_starts_at} ({mission_starts_relative})", inline: false },
          { name: "Message", value: "{mission_body}", inline: false },
          { name: "Jump", value: "[Original message]({jump_url})", inline: false },
          { name: "Your status", value: "{user_notify} · {user_rsvp}", inline: false },
        ] } },
    { id: 8, guild_id: 855675560902262785, kind: "mission_dm", name: "Training op", is_default: false,
      created_at: "2026-05-12T08:00:00+00:00", updated_at: "2026-05-12T08:00:00+00:00",
      json_blob: { color: "#5865f2", title: "📚 Training — {mission_title}", description: "Training session\n\n{mission_body}",
        fields: [{ name: "Starts", value: "{mission_starts_at}", inline: false }] } },
    { id: 9, guild_id: 855675560902262785, kind: "reminder_dm", name: "Default reminder", is_default: true,
      created_at: "2026-05-12T08:00:00+00:00", updated_at: "2026-05-12T08:00:00+00:00",
      json_blob: { color: "#faa61a", title: "⏰ {minutes_before_human} reminder — {server_name}", timestamp: "start",
        fields: [
          { name: "Starts", value: "{mission_starts_at} ({mission_starts_relative})", inline: false },
          { name: "Message", value: "{mission_body}", inline: false },
          { name: "Your status", value: "{user_notify} · {user_rsvp}", inline: false },
        ] } },
    { id: 10, guild_id: 855675560902262785, kind: "rsvp_summary", name: "Live tally", is_default: true,
      created_at: "2026-05-12T08:00:00+00:00", updated_at: "2026-05-12T08:00:00+00:00",
      json_blob: { color: "#5865f2", title: "🎯 {mission_title}", description: "Starts {mission_starts_at} ({mission_starts_relative})\n[Original message]({jump_url})",
        fields: [
          { name: "✅ Going ({going_count})", value: "{going_list}", inline: true },
          { name: "❓ Maybe ({maybe_count})", value: "{maybe_list}", inline: true },
          { name: "❌ Not going ({not_count})", value: "{not_list}", inline: true },
        ], footer: { text: "Mission #{mission_id} · Awaiting {awaiting_count} / {eligible_count}" } } },
    { id: 11, guild_id: 855675560902262785, kind: "announcement", name: "Standard announcement", is_default: true,
      created_at: "2026-05-12T08:00:00+00:00", updated_at: "2026-05-12T08:00:00+00:00",
      json_blob: { color: "#5865f2", title: "**{mission_title}**", description: "{mission_body}\n\nStarts {mission_starts_at} ({mission_starts_relative})", footer: { text: "{server_name}" } } },
  ],
  role_bindings: [
    { role_id: 922302344031526933, kind: "mission_dm", template_id: 7 },
  ],
  nextTemplateId: 12,
  arma_servers: [
    {
      id: 1, guild_id: 855675560902262785, display_name: "Sandbox",
      ptero_panel_url: "http://192.168.0.250:8447", ptero_client_key: "•••••••• (set)",
      ptero_server_identifier: "5e01be65", summary_channel_id: "1234567890123456789",
      summary_channel_template: "{state_emoji} {server_name}", detail_channel_id: "1234567890123456791",
      detail_message_id: "9988776655443322110", poll_interval_sec: 60, enabled: true,
      last_state: { state: "running", name: "Sandbox Server", cpu_pct: 8.2, memory_bytes: 1503238144, memory_limit_bytes: 4294967296, disk_bytes: 12884901888, uptime_ms: 384300000, error: null },
      last_polled_at: nowMinusSec(12), created_at: "2026-05-20T08:00:00+00:00", updated_at: "2026-05-31T14:00:00+00:00",
    },
  ],
  nextArmaId: 2,
};

function futureISO(days, minutesPastHalf) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(12, 30, 0, 0);
  return d.toISOString();
}
function pastISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(12, 30, 0, 0);
  return d.toISOString();
}
function nowMinusSec(sec) { return new Date(Date.now() - sec * 1000).toISOString(); }

function missionCounts(m) {
  return { going: m.rsvps.going.length, maybe: m.rsvps.maybe.length, not: m.rsvps.not.length };
}
function missionListItem(m) {
  const { rsvps, ...rest } = m;
  return { ...rest, rsvp_counts: missionCounts(m) };
}

/* The demo "fetch": returns parsed JSON (or throws like the real api()). */
async function demoFetch(path, opts = {}) {
  await new Promise((r) => setTimeout(r, 220)); // simulate latency for skeletons
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  const db = DEMO_DB;

  // auth/config + auth/discord
  if (path === "/auth/config") return { client_id: "demo-client-id" };
  if (path.startsWith("/auth/discord")) return { ...db.auth };
  if (path === "/me") return { user_id: db.auth.user_id, username: db.auth.username, avatar: db.auth.avatar };
  if (path === "/bots") return { bots: db.bots };
  if (path === "/me/guilds") return { guilds: db.guilds };

  // strip the guild prefix
  const gm = path.match(/^\/bots\/[^/]+\/guilds\/[^/]+(.*)$/);
  const sub = gm ? gm[1].split("?")[0] : path;
  const query = (path.split("?")[1] || "");

  if (sub === "/settings" && method === "GET")
    return { settings: { ...db.settings }, monitored_roles: clone(db.monitored_roles), available_roles: clone(db.available_roles) };
  if (sub === "/settings" && method === "PATCH") {
    Object.assign(db.settings, body);
    if (body.rsvp_channel_id === null) db.settings.rsvp_channel_id = null;
    if (body.default_reminders) {
      const arr = [...new Set(String(body.default_reminders).split(",").map(Number))].sort((a, b) => b - a);
      db.settings.default_reminders = arr.join(",");
    }
    return { ...db.settings };
  }
  if (sub === "/channels") return { channels: clone(db.channels) };

  if (sub === "/roles" && method === "POST") {
    const exists = db.monitored_roles.some((r) => String(r.id) === String(body.role_id));
    if (!exists) {
      const r = db.available_roles.find((x) => String(x.id) === String(body.role_id));
      if (r) db.monitored_roles.push({ ...r });
    }
    return { added: !exists };
  }
  const roleDel = sub.match(/^\/roles\/(\d+)$/);
  if (roleDel && method === "DELETE") {
    const before = db.monitored_roles.length;
    db.monitored_roles = db.monitored_roles.filter((r) => String(r.id) !== roleDel[1]);
    return { removed: db.monitored_roles.length < before };
  }

  // missions
  if (sub === "/missions" && method === "GET") {
    const stMatch = query.match(/state=(\w+)/);
    const st = stMatch ? stMatch[1] : "upcoming";
    const now = Date.now();
    let list = db.missions.filter((m) => {
      const t = new Date(m.mission_utc).getTime();
      if (st === "upcoming") return t >= now && !m.cancelled;
      if (st === "past") return t < now || m.cancelled;
      return true;
    });
    list.sort((a, b) => st === "past"
      ? new Date(b.mission_utc) - new Date(a.mission_utc)
      : new Date(a.mission_utc) - new Date(b.mission_utc));
    return { missions: list.map(missionListItem) };
  }
  if (sub === "/missions" && method === "POST") {
    return { queued: true, mission_utc: new Date(Date.now() + 36e5).toISOString() };
  }
  const mDetail = sub.match(/^\/missions\/(\d+)$/);
  if (mDetail && method === "GET") {
    const m = db.missions.find((x) => x.id === Number(mDetail[1]));
    return m ? clone(m) : err(404, "Mission not found");
  }
  if (mDetail && method === "PATCH") {
    const m = db.missions.find((x) => x.id === Number(mDetail[1]));
    if (m) m.title = body.title ? body.title : null;
    return clone(m);
  }
  const mCancel = sub.match(/^\/missions\/(\d+)\/cancel$/);
  if (mCancel) {
    const m = db.missions.find((x) => x.id === Number(mCancel[1]));
    if (m) m.cancelled = true;
    return { cancelled: true };
  }
  const mResched = sub.match(/^\/missions\/(\d+)\/reschedule$/);
  if (mResched) {
    const m = db.missions.find((x) => x.id === Number(mResched[1]));
    const newUtc = new Date(body.when_local.replace(" ", "T") + "Z").toISOString();
    if (m) m.mission_utc = newUtc;
    return { rescheduled: true, mission_utc: newUtc };
  }

  // templates
  if (sub === "/templates" && method === "GET") {
    const kindMatch = query.match(/kind=([^&]+)/);
    const kind = kindMatch ? decodeURIComponent(kindMatch[1]) : null;
    const list = kind ? db.templates.filter((t) => t.kind === kind) : db.templates;
    return { templates: clone(list), role_bindings: clone(db.role_bindings) };
  }
  if (sub === "/templates" && method === "POST") {
    const id = db.nextTemplateId++;
    if (body.is_default) db.templates.forEach((t) => { if (t.kind === body.kind) t.is_default = false; });
    db.templates.push({ id, guild_id: 855675560902262785, ...body,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return { id };
  }
  const tPatch = sub.match(/^\/templates\/(\d+)$/);
  if (tPatch && method === "PATCH") {
    const t = db.templates.find((x) => x.id === Number(tPatch[1]));
    if (t) {
      if (body.is_default) db.templates.forEach((x) => { if (x.kind === t.kind && x.id !== t.id) x.is_default = false; });
      Object.assign(t, body, { updated_at: new Date().toISOString() });
    }
    return { id: Number(tPatch[1]) };
  }
  if (tPatch && method === "DELETE") {
    const id = Number(tPatch[1]);
    const before = db.templates.length;
    db.templates = db.templates.filter((x) => x.id !== id);
    db.role_bindings = db.role_bindings.filter((b) => b.template_id !== id);
    return { deleted: db.templates.length < before };
  }
  if (sub === "/role-bindings" && method === "POST") {
    db.role_bindings = db.role_bindings.filter((b) => !(String(b.role_id) === String(body.role_id) && b.kind === body.kind));
    if (body.template_id != null) db.role_bindings.push({ role_id: Number(body.role_id), kind: body.kind, template_id: body.template_id });
    return { ok: true };
  }

  // detection rules
  if (sub === "/detection-rules" && method === "GET") return { rules: clone(db.detection_rules) };
  if (sub === "/detection-rules" && method === "POST") {
    const id = db.nextRuleId++;
    db.detection_rules.push({ id, guild_id: 855675560902262785, match_text: body.match_text, template_id: body.template_id, priority: body.priority || 0, created_at: new Date().toISOString() });
    return { id };
  }
  const rPatch = sub.match(/^\/detection-rules\/(\d+)$/);
  if (rPatch && method === "PATCH") {
    const r = db.detection_rules.find((x) => x.id === Number(rPatch[1]));
    if (r) Object.assign(r, { match_text: body.match_text, template_id: body.template_id, priority: body.priority || 0 });
    return { id: Number(rPatch[1]) };
  }
  if (rPatch && method === "DELETE") {
    const before = db.detection_rules.length;
    db.detection_rules = db.detection_rules.filter((x) => x.id !== Number(rPatch[1]));
    return { deleted: db.detection_rules.length < before };
  }

  // modlist
  if (sub === "/modlist" && method === "GET") return clone(db.modlist);
  if (sub === "/modlist" && method === "POST") {
    if (body.text !== undefined) db.modlist.text = body.text || "";
    if (body.url !== undefined) db.modlist.url = body.url || "";
    if (body.channel_id !== undefined) { db.modlist.channel_id = body.channel_id || null; db.settings.modlist_channel_id = body.channel_id || null; }
    db.modlist.updated_at = new Date().toISOString();
    return { ok: true };
  }
  const mlPatch = sub.match(/^\/missions\/(\d+)\/modlist$/);
  if (mlPatch && method === "PATCH") {
    const m = db.missions.find((x) => x.id === Number(mlPatch[1]));
    if (m) { m.modlist_url = body.url || null; m.modlist_text = body.text || null; }
    return { ok: true };
  }

  // arma servers
  if (sub === "/arma-servers" && method === "GET") {
    // simulate a fresh poll: bump last_polled_at + jitter the cpu a little
    db.arma_servers.forEach((s) => {
      if (s.enabled && s.last_state && s.last_state.state === "running") {
        s.last_polled_at = new Date().toISOString();
        s.last_state.cpu_pct = Math.round((4 + Math.random() * 12) * 10) / 10;
        s.last_state.memory_bytes = Math.floor(1.2e9 + Math.random() * 0.6e9);
        s.last_state.uptime_ms += 1000;
      }
    });
    return { servers: clone(db.arma_servers) };
  }
  if (sub === "/arma-servers" && method === "POST") {
    const id = db.nextArmaId++;
    db.arma_servers.push({
      id, guild_id: 855675560902262785,
      display_name: body.display_name || "", ptero_panel_url: body.ptero_panel_url || "",
      ptero_client_key: body.ptero_client_key ? "•••••••• (set)" : null,
      ptero_server_identifier: body.ptero_server_identifier || "",
      summary_channel_id: body.summary_channel_id || null,
      summary_channel_template: body.summary_channel_template || "{state_emoji} {server_name}",
      detail_channel_id: body.detail_channel_id || null, detail_message_id: null,
      poll_interval_sec: body.poll_interval_sec || 60, enabled: body.enabled !== false,
      last_state: { state: "unknown", name: body.display_name || "Server", error: null },
      last_polled_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return { id };
  }
  const aPatch = sub.match(/^\/arma-servers\/(\d+)$/);
  if (aPatch && method === "PATCH") {
    const s = db.arma_servers.find((x) => x.id === Number(aPatch[1]));
    if (s) {
      const { ptero_client_key, ...rest } = body;
      Object.assign(s, rest, { updated_at: new Date().toISOString() });
      if (ptero_client_key) s.ptero_client_key = "•••••••• (set)"; // rotate only if provided
    }
    return { id: Number(aPatch[1]) };
  }
  if (aPatch && method === "DELETE") {
    const before = db.arma_servers.length;
    db.arma_servers = db.arma_servers.filter((x) => x.id !== Number(aPatch[1]));
    return { deleted: db.arma_servers.length < before };
  }

  return err(404, `Demo: no stub for ${method} ${path}`);
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function err(status, detail) { const e = new Error(`${status}: ${detail}`); throw e; }
