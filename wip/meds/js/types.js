// ================================================
// types.js — the shapes, written down once
// ================================================
// This file has no runtime code and is not loaded by the page. It exists so the
// editor and `tsc --noEmit` know what a Med, a Dose, a Weight and a Container
// actually are, and so the field names that mean something other than what they
// look like are documented in the one place nobody can avoid reading.
//
// THE FOUR TRAPS, up front, because each has already cost real time:
//
//   1. `med.frequency` is in DAYS, not hours and not "times per day". A med taken
//      three times a day has frequency 1 and three entries in `doses`.
//   2. `container.dose` is the container's STRENGTH — what one unit in it delivers
//      — not an amount that was taken. Nothing is consumed by reading it.
//   3. A number in `med.doses` is the TOTAL at that slot, not per-tablet. Two
//      500 mg tablets at 08:00 is `500` twice if they are two slots, but `1000`
//      once if they are one.
//   4. `shot` means dose, `pen` means container. Both names are historical, from
//      when this app tracked one injected medication. D-18 renames them; until
//      then the wire format still says shots/pens and so does every field here.
//
// Everything is stored as plain JSON and round-trips through localStorage and the
// sync worker, so no type here may contain a Date, a Map, a Set or undefined.

/**
 * A medication the user is taking or has taken.
 *
 * @typedef {Object} Med
 * @property {string} id
 * @property {string} name              what the user calls it — brand or generic
 * @property {string} [generic]         active ingredient, shown under the name
 * @property {string} [presetId]        which preset it came from, if any
 * @property {'pill'|'injection'|'liquid'|'patch'|'other'} type
 * @property {string} category          must exist in CATEGORY_ORDER or the med is
 *                                      invisible in the picker — adding a category
 *                                      to a preset without adding it there is a
 *                                      silent failure
 * @property {number[]} doses           one entry PER SLOT PER DAY. The number is the
 *                                      total taken at that slot, in `unit`
 * @property {Array<string|{time:string, dose?:number, count?:number, per?:number}>} [scheduleTimes]
 *                                      When it is taken. HETEROGENEOUS on purpose:
 *                                      older data stores bare 'HH:MM' strings, newer
 *                                      data stores objects. Read it through
 *                                      getScheduleSlots(), never directly. `count`
 *                                      and `per` remember that the user typed
 *                                      "2 x 5mg" so the editor round-trips it
 * @property {string} [scheduleDay]     'auto' | 'daily' | a weekday name
 * @property {string} [scheduleTime]    'auto' | 'HH:MM'
 * @property {{takeWithinDays?:number, minGapDays?:number, text?:string}} [missedDose]
 *                                      official guidance for a late dose. Absent
 *                                      means "no published advice", and the
 *                                      take-or-skip fallback is half the interval
 * @property {string} unit              'mg', 'ml', 'tablet' — display only, no
 *                                      conversion is ever done on it
 * @property {number} frequency         DAYS between doses. 1 = daily, 7 = weekly.
 *                                      Mandatory today, which is why PRN meds do
 *                                      not fit yet (T-15)
 * @property {number|null} halfLife     HOURS. null means unknown, and unknown must
 *                                      stay null — a default here draws a confident
 *                                      curve for a med nobody has data for (I-07)
 * @property {number} [timeToPeak]      HOURS to Tmax. Feeds the absorption model
 * @property {Object<string,number>} [dose2halfLife]  per-dose half-life overrides,
 *                                      keyed by the dose as a string
 * @property {number|null} [preferredNextDose]
 * @property {number} penCapacity       units per container (30 tablets, 4 doses)
 * @property {number} pensPerPackage    containers per box, for supply maths
 * @property {string} color             hex, used by the chart and the badges
 * @property {boolean} [splitDose]      one dose may be drawn from a container of a
 *                                      different strength. Implied for everything
 *                                      that is not an injection
 * @property {number|null} [graphStep]  exact y-axis step, null = automatic
 * @property {number} [trashedAt]       present ONLY while in `trashedMeds`;
 *                                      restoreMed deletes it
 */

/**
 * One dose that was taken. Called a "shot" everywhere because this app began as a
 * Mounjaro logger; it is any dose of anything now.
 *
 * @typedef {Object} Dose
 * @property {string} id                sync identity — every dose has had one since v2
 * @property {string} medId             may point at a med in `trashedMeds`
 * @property {number} dose              amount actually taken, in the med's `unit`
 * @property {number} timestamp         ms since epoch. THE authority on when. Every
 *                                      rolling-window calculation must use this and
 *                                      never `date`, which is a local-time string
 *                                      and shifts across timezones (T-25)
 * @property {string} date              'YYYY-MM-DD' as shown to the user
 * @property {string} time              'HH:MM' as shown to the user
 * @property {string|null} [location]   injection site, for meds that have one
 * @property {string|null} [penId]      the container it came from, or null for
 *                                      unassigned. Deleting a container MUST null
 *                                      this — see Store.deleteContainer
 * @property {boolean} [estimated]      created by the backfill estimator rather than
 *                                      logged by the user. clearEstimated() removes
 *                                      exactly these, and their containers
 */

/**
 * One weight reading.
 *
 * @typedef {Object} Weight
 * @property {string} id
 * @property {number} kg                ALWAYS kilograms in storage. lbs and st-lbs
 *                                      exist only at the edges of the UI
 * @property {number} timestamp
 * @property {string} date
 * @property {string} time
 */

/**
 * A supply container — a pen, a box, a bottle. Called a "pen" in storage.
 *
 * @typedef {Object} Container
 * @property {string} id
 * @property {string} medId
 * @property {number} dose              STRENGTH of this container, i.e. what one unit
 *                                      from it delivers. Not an amount taken
 * @property {number} capacity          units it holds when full
 * @property {number} [used]            units taken from it so far. DERIVED —
 *                                      recomputePenState sums the doses that cite
 *                                      this container; do not write it directly
 * @property {number} [usedOffset]      manual correction from the edit-supply modal,
 *                                      added on top of what the doses consumed. This
 *                                      is the field a correction actually writes to
 * @property {boolean} [manuallyExhausted]  user said it is empty even though the
 *                                      logged doses do not account for all of it
 * @property {string|null} [note]       'estimated' marks one the backfill estimator
 *                                      invented; clearEstimated() deletes those
 * @property {string} [openedDate]     'YYYY-MM-DD'. Set by recomputePenState from
 *                                     the first dose that cites this container —
 *                                     derived, never authored
 * @property {string} [exhaustedDate]  'YYYY-MM-DD'. Likewise, from the dose that
 *                                     emptied it
 */

/**
 * User settings. Three tiers, and which tier a key is in changes its behaviour:
 *
 *   DEVICE_KEYS         never leave this device. No sync operation is generated and
 *                       none is applied. Theme, chart ranges, which cards show.
 *   VIEW_ONLY_SETTINGS  DEVICE_KEYS plus keys that DO sync but must never look like
 *                       a data conflict. Excluded from Store.canonical()
 *   everything else     real data. Changing it can raise a sync conflict
 *
 * @typedef {Object} Settings
 * @property {boolean} [weightTrackingEnabled]
 * @property {number} [startKg]
 * @property {number} [goalKg]
 * @property {number} [userHeight]      centimetres
 * @property {'kg'|'lbs'|'st'} [weightUnit]
 * @property {boolean} [showBmi]
 * @property {string} [dateFormat]
 * @property {'12hr'|'24hr'} [timeFormat]
 * @property {string} [weekStart]
 * @property {string} [theme]           DEVICE_KEY
 * @property {string} [accent]          DEVICE_KEY
 * @property {boolean} [dashAll]        DEVICE_KEY
 * @property {string} [medRange]        DEVICE_KEY
 * @property {string} [weightRange]     DEVICE_KEY
 * @property {boolean} [pushEnabled]    DEVICE_KEY — a push subscription belongs to a
 *                                      browser, so the toggle has to as well
 * @property {string[]} [shotLocations] injection sites, in the rotation order the
 *                                      user arranged them in
 * @property {number} [onboardedAt]     syncs, but never raises a conflict
 */

/**
 * The whole app state, as stored and as synced. Every array here is a sync
 * collection and must be registered in all six places listed at SYNC_COLLECTIONS.
 *
 * @typedef {Object} AppState
 * @property {number} version
 * @property {Med[]} meds
 * @property {Med[]} trashedMeds        kept whole, so restoring loses nothing
 * @property {Dose[]} shots
 * @property {Weight[]} weights
 * @property {Container[]} pens
 * @property {Settings} settings
 * @property {Object} user
 * @property {string|null} activeMedId  per device; normalize() resets it from the
 *                                      device blob, so it never syncs
 */

// NO `export` and no `import` in this file, deliberately. Adding either makes it a
// module, and typedefs in a module are private to it — every other file here is a
// plain script, so the types would silently stop applying anywhere.
