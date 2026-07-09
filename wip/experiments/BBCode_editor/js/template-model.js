// template-model.js - the portable template JSON: factory, normalization, validation,
// import/export, and entry-schema helpers shared by the rest of the app.

import { uid, deepClone } from "./util.js";

export const TEMPLATE_FORMAT = "bbcode-template";
export const TEMPLATE_FORMAT_VERSION = 1;

/** A brand-new template: empty schema, but usable Use-mode defaults (input + output are modules). */
export function blankTemplate(name) {
  const now = new Date().toISOString();
  return {
    format: TEMPLATE_FORMAT,
    formatVersion: TEMPLATE_FORMAT_VERSION,
    meta: {
      id: uid("tpl"),
      name: name || "New Template",
      description: "",
      createdAt: now,
      modifiedAt: now,
    },
    variables: [],
    entrySchema: { titleField: "", fields: [] },
    parser: { variants: [] },
    merge: { entryKey: { field: "" }, scalars: { mode: "preferIncomingIfNonEmpty", exceptions: [] }, arrays: {} },
    computed: [],
    collections: [],
    modules: [
      {
        id: uid("mod"),
        type: "raw-input",
        title: "1. Add Data",
        zone: "left",
        order: 0,
        collapsible: false,
        defaultOpen: true,
        accept: [".txt"],
        pasteBox: true,
        buttonLabel: "Process Pasted Text",
      },
    ],
    layout: {
      columns: [
        { id: "left", width: "1fr" },
        { id: "right", width: "1fr" },
      ],
      outputPanel: {
        zone: "right",
        tabs: ["preview", "code"],
        copyButtons: ["top", "bottom"],
        download: { filenameFrom: "", ext: ".txt" },
      },
      collapseControls: true,
    },
    output: { template: "" },
    dataImport: null,
  };
}

/** Fill any missing sections so the rest of the app never needs null checks. */
export function normalizeTemplate(raw) {
  const base = blankTemplate();
  const tpl = { ...base, ...deepClone(raw) };
  tpl.format = TEMPLATE_FORMAT;
  tpl.formatVersion = tpl.formatVersion || TEMPLATE_FORMAT_VERSION;
  tpl.meta = { ...base.meta, ...(tpl.meta || {}) };
  tpl.variables = Array.isArray(tpl.variables) ? tpl.variables : [];
  tpl.entrySchema = { titleField: "", fields: [], ...(tpl.entrySchema || {}) };
  tpl.entrySchema.fields = Array.isArray(tpl.entrySchema.fields) ? tpl.entrySchema.fields : [];
  tpl.parser = { variants: [], ...(tpl.parser || {}) };
  tpl.parser.variants = Array.isArray(tpl.parser.variants) ? tpl.parser.variants : [];
  tpl.merge = { ...base.merge, ...(tpl.merge || {}) };
  tpl.merge.arrays = tpl.merge.arrays || {};
  tpl.computed = Array.isArray(tpl.computed) ? tpl.computed : [];
  tpl.collections = Array.isArray(tpl.collections) ? tpl.collections : [];
  tpl.modules = Array.isArray(tpl.modules) ? tpl.modules : [];
  tpl.layout = { ...base.layout, ...(tpl.layout || {}) };
  tpl.layout.columns = Array.isArray(tpl.layout.columns) && tpl.layout.columns.length ? tpl.layout.columns : base.layout.columns;
  tpl.layout.outputPanel = { ...base.layout.outputPanel, ...(tpl.layout.outputPanel || {}) };
  tpl.output = { template: "", ...(tpl.output || {}) };
  return tpl;
}

/** Light structural validation for imported files. Returns a list of problems (empty = ok). */
export function validateTemplate(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return ["File is not a JSON object."];
  if (raw.format && raw.format !== TEMPLATE_FORMAT) errors.push(`Unknown format "${raw.format}".`);
  if (!raw.meta?.name && !raw.name) errors.push("Template has no name (meta.name).");
  if (raw.entrySchema && !Array.isArray(raw.entrySchema.fields)) errors.push("entrySchema.fields must be an array.");
  if (raw.modules && !Array.isArray(raw.modules)) errors.push("modules must be an array.");
  if (raw.output && typeof raw.output.template !== "string") errors.push("output.template must be a string.");
  if (raw.formatVersion && raw.formatVersion > TEMPLATE_FORMAT_VERSION)
    errors.push(`Template format version ${raw.formatVersion} is newer than this app supports (${TEMPLATE_FORMAT_VERSION}).`);
  return errors;
}

/** Prepare an imported template object: normalize + avoid id collisions with existing templates. */
export function prepareImportedTemplate(raw, existingTemplates = []) {
  const tpl = normalizeTemplate(raw);
  const existingIds = new Set(existingTemplates.map((t) => t.meta.id));
  if (!tpl.meta.id || existingIds.has(tpl.meta.id)) tpl.meta.id = uid("tpl");
  return tpl;
}

export function serializeTemplate(template) {
  return JSON.stringify(template, null, 2);
}

/** What kind of JSON did the user hand us? "template" | "backup" | "legacy" | "unknown" */
export function detectImportKind(json) {
  if (!json || typeof json !== "object") return "unknown";
  if (json.format === TEMPLATE_FORMAT || (json.meta && json.output && !json.templates)) return "template";
  if (Array.isArray(json.templates) && json.data !== undefined) return "backup";
  if (Array.isArray(json.games)) return "legacy";
  return "unknown";
}

/*********************
 * Entry-schema helpers
 *********************/

/** Walk every field in the schema tree. cb(field, path, parentArrayField). path like "files[].buildId". */
export function walkFields(fields, cb, prefix = "", parentArray = null) {
  for (const field of fields || []) {
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    cb(field, path, parentArray);
    if (field.type === "array") walkFields(field.itemFields, cb, `${path}[]`, field);
  }
}

/** Find a field definition by dot path relative to the entry ("files" / "customGroups.files"). */
export function findField(entrySchema, path) {
  let fields = entrySchema?.fields || [];
  let found = null;
  for (const part of String(path).split(".")) {
    found = fields.find((f) => f.key === part) || null;
    if (!found) return null;
    fields = found.itemFields || [];
  }
  return found;
}

function defaultForField(field) {
  if (field.type === "array") return [];
  if (field.type === "toggle" || field.type === "flag") return field.default ?? false;
  if (field.type === "toggle-choice") return field.default ?? field.offValue ?? false;
  return field.default ?? "";
}

/** Fresh entry data object with schema defaults (arrays start empty). */
export function defaultEntryData(entrySchema) {
  const data = {};
  for (const field of entrySchema?.fields || []) data[field.key] = defaultForField(field);
  return data;
}

/** Fresh item for an array field, with defaults + optional newItemDefaults overrides. */
export function defaultArrayItem(arrayField, overrides = {}) {
  const item = {};
  for (const field of arrayField?.itemFields || []) item[field.key] = defaultForField(field);
  Object.assign(item, arrayField?.newItemDefaults || {}, overrides);
  return item;
}

/** Apply schema defaults to an existing (possibly imported) entry data object, recursively. */
export function applySchemaDefaults(data, fields) {
  for (const field of fields || []) {
    if (data[field.key] === undefined || data[field.key] === null) {
      data[field.key] = defaultForField(field);
    } else if (field.type === "array" && Array.isArray(data[field.key])) {
      for (const item of data[field.key]) {
        if (item && typeof item === "object") applySchemaDefaults(item, field.itemFields);
      }
    }
  }
  return data;
}

/** Sort an array field's items per its sort config ({byField, orderPrefixes}). Mutates + returns. */
export function sortArrayField(items, arrayField) {
  const sort = arrayField?.sort;
  if (!sort?.byField || !Array.isArray(items)) return items;
  const prefixes = sort.orderPrefixes || [];
  const rank = (value) => {
    const str = String(value ?? "");
    const idx = prefixes.findIndex((p) => str.startsWith(p));
    return idx === -1 ? prefixes.length : idx;
  };
  items.sort((a, b) => {
    const ra = rank(a?.[sort.byField]);
    const rb = rank(b?.[sort.byField]);
    if (ra !== rb) return ra - rb;
    return String(a?.[sort.byField] ?? "").localeCompare(String(b?.[sort.byField] ?? ""));
  });
  return items;
}
