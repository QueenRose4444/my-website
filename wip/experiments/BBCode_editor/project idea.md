# Project Refactor Prompt: Generic BBCode Engine & Form Builder

**Location**
All work to be done in: `/wip/experiments/BBCode_editor`

**High-Level Goal**
Refactor the current hard-coded `bbcode_editor.js` into a **Generic Template Engine**.
The goal is to create a "Tool Builder." The application will load with **zero** hard-coded logic. Instead, it will read user-defined "Templates" to generate the UI and processing rules dynamically.

---

### 1. UI Constraints & Styling
* **The Top Bar:** The existing top navigation bar (Home, Meds, Experiments, Account, etc.) **must remain exactly as it is**. Do not modify its HTML or CSS class structure.
* **Main Layout:** You have full creative freedom to redesign the main content area (below the top bar) to accommodate the new "Builder" and "Editor" interfaces. It should look modern and clean.

---

### 2. Architecture: The Template Library System

We are moving from a single-purpose tool to a **Library of Tools**.

**A. Template Storage (The Library)**
* Users can create and save **multiple** distinct templates on their account (or LocalStorage).
* **Metadata:** Each saved template must track:
    * `name` (Unique ID)
    * `createdDate`
    * `lastEditedDate`
    * `lastUsedDate`
* **Switching:** The UI must provide a dropdown or menu to switch between loaded templates (e.g., switch from "Steam Game Formatter" to "Movie Info Formatter").
* **Name Conflicts:** If a user imports or creates a template with a name that already exists, prompt the user to rename it (e.g., "Steam Formatter (Copy)").

**B. The Data Structure Separation**
We must distinguish between the **Tool** and the **Work**.

1.  **The Template Object:** (The "Tool")
    * Contains: Layout, Regex Rules, Widgets, Output Logic.
    * *Managed via:* The Template Library.
2.  **The User Data Object:** (The "Work")
    * Contains: The specific values entered for a specific session (e.g., "Game: Half-Life 3", "Version: 1.0").
    * *Managed via:* A separate "Record/Collection" dropdown *within* the active template.

---

### 3. Core Features

#### A. The "Smart" Parser (User-Defined Logic)
* **Input:** A raw text dump area.
* **Logic Builder:** A UI where the user creates extraction rules.
    * *Example:* User creates a rule: "Find text after 'Version:'" -> Save to variable `{version}`.

#### B. The Visual Form Builder (Drag-and-Drop)
* A GUI interface where the user builds the input form for their template.
* **Widgets:** Text Input, Color Picker, Checkbox, Dropdown, Repeater/List.
* **Binding:** Each widget binds to a variable.

#### C. The Logic Engine
* Users can define conditional output logic.
* *Example:* "IF `{crack_type}` contains 'Goldberg', THEN show `{crack_instructions}`."

---

### 4. User Flow (The "Empty State" & Library)

When the user loads the page:
1.  **Initialize Library:** Check LocalStorage/Account for a list of saved templates.
2.  **If Templates Exist:**
    * Load the one with the most recent `lastUsedDate`.
    * Show the "Template Switcher" in the UI to allow changing tools.
3.  **If Library is Empty:**
    * Show a clean "Welcome" screen.
    * **Actions:** "Create New Template" OR "Import Template File (.json)".

---

### 5. Deliverables

1.  **Data Structure Design:** Please propose the JSON structure for the `TemplateLibrary`, `Template`, and `SessionData` objects.
2.  **State Management:** Explain how we will handle switching templates without losing unsaved data in the current session.
3.  **Proof of Concept:** Implement the **Template Library Manager** (Create, List, Switch, Delete) and the "Empty State" screen.