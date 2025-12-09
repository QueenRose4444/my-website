# Project: Universal BBCode Template Engine (Refactor)

## Overview
Refactor the existing, single-purpose BBCode editor (`/wip/experiments/BBCode_editor`) into a **Universal Template Builder**.

Currently, the application has hardcoded logic for specific games. The goal is to decouple this logic entirely. The system must allow users to define parsers, form fields, and output templates via a JSON configuration.

**Core Objective:** The new system must be able to replicate the current "Steam Game Formatter" entirely via a JSON template, while allowing users to create, export, and share new templates (e.g., Movie Database, Recipe Formatter) easily.

---

## 1. Technical Constraints
* **Location:** `/wip/experiments/BBCode_editor`
* **Stack:** Vanilla JavaScript (ES6+), TailwindCSS (CDN), LocalStorage.
* **Forbidden:** Do NOT use React, Vue, or build steps. Keep it lightweight and raw.
* **UI Preservation:** The `<header class="top-bar">` and its CSS must remain **untouched**.
* **Auth:** Preserve existing `firebase/auth` logic (login/register/sync).

---

## 2. Data Architecture

### A. The Template Structure (The "Tool")
This defines *how* data is parsed and formatted. Users can export this single object to share the tool with friends.

```javascript
{
  id: "steam_formatter_v1",
  name: "Steam Game Formatter",
  description: "Parses NFO text into BBCode",
  version: "1.0.0",
  // 1. PARSER CONFIG
  parser: {
    rules: [
      { id: "ver", pattern: "Version: (.*)", target: "gameVersion" }
    ]
  },
  // 2. FORM CONFIG
  formFields: [
    { type: "text", var: "gameTitle", label: "Title" },
    { 
      type: "checkbox", 
      var: "hasCrack", 
      label: "Include Crack?",
      // CONDITIONAL VISIBILITY
      showsFields: ["crackType", "crackUrl"] 
    },
    // NESTED REPEATER (Critical for current app parity)
    { 
      type: "repeater", 
      var: "updates", 
      label: "Updates", 
      children: [
        { type: "text", var: "updTitle" },
        { 
          type: "repeater", // Level 2 nesting
          var: "links", 
          children: [{ type: "text", var: "url" }] 
        }
      ] 
    }
  ],
  // 3. OUTPUT CONFIG
  outputTemplate: "[b]{gameTitle}[/b]\n[url={crackUrl}]Crack[/url]"
}
````

### B. The Session Data (The "Save File")

This allows users to have multiple "projects" open at once.

```javascript
{
  activeTemplateId: "steam_formatter_v1",
  records: [
    { id: 1, name: "Half-Life 3", data: { gameTitle: "Half-Life 3", ... } },
    { id: 2, name: "Portal 3", data: { gameTitle: "Portal 3", ... } }
  ]
}
```

-----

## 3\. Core Features & Requirements

### A. The "Legacy" Benchmark (CRITICAL)

You must create a default JSON template (`default_templates/steam_formatter.json`) that replicates the **exact** functionality of the current hardcoded app.

  * **Must include:** All current fields (Clean/Crack URLs, Custom Groups, Updates, Patch Notes).
  * **Must handle:** The complex nested structures (Groups -\> Files -\> Links).
  * **Outcome:** If I load this template and paste the same raw text as before, the BBCode output must be identical.

### B. Smart Parser & Regex Builder

Users shouldn't need to write raw Regex if they don't want to.

  * **Visual Builder:** "Find text between [START] and [END]".
  * **Live Preview:** Highlight matches in real-time as the user types the rule.
  * **Variable Mapping:** Extracted text auto-fills the corresponding Form Field.

### C. Import / Export System

The system must distinguish between sharing a *tool* and backing up *work*.

1.  **Export Template (.json):** Exports *only* the definition (Rules + Form + Output). Used for sharing with others.
2.  **Export Backup (.json):** Exports ALL templates + ALL saved records. Used for migration/safety.
3.  **Import Logic:**
      * Detect if file is a Template or a Backup.
      * **Conflict Handling:** If importing a template named "Steam Formatter" and one already exists, prompt to "Rename", "Overwrite", or "Cancel".

### D. Advanced Widget Support

To match current capabilities, the Form Builder needs:

1.  **Conditional Logic:** "Show Field B only if Checkbox A is checked."
2.  **Nested Repeaters:** Support at least 3 levels deep (e.g., Update -\> Provider -\> Links).
3.  **Custom Actions:** Ability to define simple JS actions (like the "Copy Crack Filename" button in the current app).

-----

## 4\. Implementation Phases

### Phase 1: Engine Foundation

  * Define the JSON Schema for Templates and Sessions.
  * Build the `TemplateManager` class (Create, Load, Save, Delete).
  * Create the "Steam Formatter" JSON file manually to prove the schema works.

### Phase 2: The Form Renderer

  * Build a dynamic form generator that reads the JSON schema.
  * Implement standard widgets (Text, Color, Checkbox).
  * **Critical:** Implement the `RepeaterWidget` that supports nesting (recursion).

### Phase 3: The Template Builder UI

  * Create the UI to allow users to build these forms *without* writing JSON.
  * Drag-and-drop form builder.
  * Visual Parser/Regex builder.

### Phase 4: Output & logic

  * Implement the template renderer (replacing variables like `{gameTitle}` in the output string).
  * Implement conditional logic blocks (`...`).

### Phase 5: Polish & Migration

  * Implement Import/Export flows.
  * Add the "Migration Wizard" that converts existing LocalStorage data into the new format.

-----

## 5\. Success Criteria

1.  The app loads with "Steam Formatter" pre-selected.
2.  I can create a NEW template called "Recipe Maker".
3.  I can add a "Ingredients" repeater list to "Recipe Maker".
4.  I can export "Recipe Maker.json" and import it in a private window.
5.  **Most Importantly:** The original Steam functionality works exactly as before, but runs entirely off the new JSON engine.

<!-- end list -->