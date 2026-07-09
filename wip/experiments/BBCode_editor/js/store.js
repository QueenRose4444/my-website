// store.js - single owner of app state, persistence and events.
// State shape:
//   appData  { formatVersion, lastUpdated, templates:[], activeTemplateId, data:{ [tplId]: {entries, activeEntryId, variables, presets} } }
//   uiState  { mode, activeBuildTab, collapsed:{ "tplId:moduleId": bool } }  (never synced)

import { debounce, deepClone } from "./util.js";

export const APP_NAME = "bbcode_template_maker";
export const ENVIRONMENT = "wip";
export const STORAGE_PREFIX = `${APP_NAME}_${ENVIRONMENT}_`;

const LOGGING_ENABLED = ENVIRONMENT === "wip";
export function log(...args) {
  if (LOGGING_ENABLED) console.log("[TPL_MAKER]", ...args);
}

function blankAppData() {
  return {
    formatVersion: 1,
    lastUpdated: null,
    templates: [],
    activeTemplateId: null,
    data: {},
  };
}

function blankUiState() {
  return { mode: "use", activeBuildTab: "fields", collapsed: {} };
}

export let state = blankAppData();
export let uiState = blankUiState();

let authManager = null;
export function setAuthManager(manager) {
  authManager = manager;
}
export function getAuthManager() {
  return authManager;
}

/*********************
 * Events
 *********************/
const listeners = new Map();

/** Subscribe. Event names: "data:field", "data:structure", "template:changed", "templates:list", "mode:changed" */
export function on(event, callback) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  return () => listeners.get(event)?.delete(callback);
}

export function emit(event, detail = {}) {
  for (const cb of listeners.get(event) || []) {
    try {
      cb(detail);
    } catch (err) {
      console.error(`[TPL_MAKER] listener for "${event}" failed:`, err);
    }
  }
}

/*********************
 * Persistence
 *********************/
export function loadLocal() {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}appData`);
    state = stored ? { ...blankAppData(), ...JSON.parse(stored) } : blankAppData();
  } catch (err) {
    console.error("[TPL_MAKER] failed to load local data:", err);
    state = blankAppData();
  }
  try {
    const storedUi = localStorage.getItem(`${STORAGE_PREFIX}uiState`);
    uiState = storedUi ? { ...blankUiState(), ...JSON.parse(storedUi) } : blankUiState();
  } catch {
    uiState = blankUiState();
  }
}

export function saveUiState() {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}uiState`, JSON.stringify(uiState));
  } catch (err) {
    console.error("[TPL_MAKER] failed to save ui state:", err);
  }
}

function saveLocal() {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}appData`, JSON.stringify(state));
  } catch (err) {
    console.error("[TPL_MAKER] failed to save local data:", err);
  }
}

const pushBackendDebounced = debounce(() => {
  pushBackend();
}, 1500);

/** Persist app data locally (and queue a backend push when logged in). Call after every mutation. */
export function save() {
  state.lastUpdated = new Date().toISOString();
  saveLocal();
  if (authManager?.isLoggedIn()) pushBackendDebounced();
}

/** Replace the whole app data (import / server pull). Caller re-renders via events. */
export function replaceState(next) {
  state = { ...blankAppData(), ...deepClone(next) };
  saveLocal();
}

/*********************
 * Backend sync
 *********************/
export async function fetchBackend() {
  if (!authManager?.isLoggedIn()) return null;
  try {
    const res = await authManager.fetchWithAuth(authManager.endpoints.data, { method: "GET" });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.templates ? data : null;
  } catch {
    return null;
  }
}

export async function pushBackend() {
  if (!authManager?.isLoggedIn()) return false;
  try {
    await authManager.fetchWithAuth(authManager.endpoints.data, {
      method: "POST",
      body: JSON.stringify(state),
    });
    log("Pushed data to backend.");
    return true;
  } catch (err) {
    console.error("[TPL_MAKER] backend push failed:", err);
    return false;
  }
}

/*********************
 * Template / entry helpers
 *********************/
export function getTemplates() {
  return state.templates;
}

export function getActiveTemplate() {
  return state.templates.find((t) => t.meta?.id === state.activeTemplateId) || null;
}

export function setActiveTemplate(templateId) {
  state.activeTemplateId = templateId;
  save();
  emit("template:changed", { templateId });
}

/** Per-template data bucket, created on demand. */
export function getTemplateData(templateId) {
  if (!templateId) return null;
  if (!state.data[templateId]) {
    state.data[templateId] = { entries: [], activeEntryId: null, variables: {}, presets: [] };
  }
  const bucket = state.data[templateId];
  bucket.entries = bucket.entries || [];
  bucket.variables = bucket.variables || {};
  bucket.presets = bucket.presets || [];
  return bucket;
}

export function getActiveTemplateData() {
  return state.activeTemplateId ? getTemplateData(state.activeTemplateId) : null;
}

export function getActiveEntry() {
  const bucket = getActiveTemplateData();
  if (!bucket) return null;
  return bucket.entries.find((e) => e.id === bucket.activeEntryId) || null;
}

/** Resolved variable values for a template: user value if set, else template default. */
export function getVariableValues(template = getActiveTemplate()) {
  if (!template) return {};
  const bucket = getTemplateData(template.meta.id);
  const values = {};
  for (const variable of template.variables || []) {
    values[variable.key] = variable.key in bucket.variables ? bucket.variables[variable.key] : variable.default;
  }
  return values;
}

/** Count of entries across all templates (for the sync-conflict modal). */
export function countEntries(appData = state) {
  let count = 0;
  for (const bucket of Object.values(appData.data || {})) count += (bucket.entries || []).length;
  return count;
}

/*********************
 * Collapse state (ui)
 *********************/
export function isModuleOpen(templateId, moduleId, defaultOpen = true) {
  const key = `${templateId}:${moduleId}`;
  return key in uiState.collapsed ? !uiState.collapsed[key] : defaultOpen;
}

export function setModuleOpen(templateId, moduleId, open) {
  uiState.collapsed[`${templateId}:${moduleId}`] = !open;
  saveUiState();
}
