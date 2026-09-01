/* tax-tables.js — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Built 2026-08-31 by tools/build-tax-tables.mjs from the ATO's published
 * data. Australian financial year 2026-27 (2026-07-01 to 2027-06-30).
 *
 * Source: https://onlineservices.ato.gov.au/cdn/static-data/codes-tables/
 *   TC9GENTAC.json (Schedule 1 and 8 withholding coefficients)
 *   TC2TAXRTE.json (annual brackets, offsets, Medicare, HELP)
 * Licensed CC BY 4.0 by the Australian Taxation Office. payday is not endorsed by
 * or affiliated with the ATO.
 *
 * To rebuild in July:  node tools/build-tax-tables.mjs
 * ⚠ Read that script's header first — a group the ATO has not yet updated returns
 * LAST YEAR'S numbers with an open end date, and looks perfectly current.
 */
window.TaxTables = {
  "fy": "2026-27",
  "effectiveFrom": "2026-07-01",
  "effectiveTo": "2027-06-30",
  "builtAt": "2026-08-31",
  "withholding": {
    "scale2": {
      "effectiveFrom": "2026-07-01",
      "verified": null,
      "bands": [
        {
          "maxWeekly": 362,
          "a": 0,
          "b": 0
        },
        {
          "maxWeekly": 538,
          "a": 0.15,
          "b": 54.3462
        },
        {
          "maxWeekly": 673,
          "a": 0.25,
          "b": 108.2135
        },
        {
          "maxWeekly": 721,
          "a": 0.17,
          "b": 54.3473
        },
        {
          "maxWeekly": 865,
          "a": 0.179,
          "b": 60.8377
        },
        {
          "maxWeekly": 1282,
          "a": 0.3227,
          "b": 185.1935
        },
        {
          "maxWeekly": 2596,
          "a": 0.32,
          "b": 181.7319
        },
        {
          "maxWeekly": 3653,
          "a": 0.39,
          "b": 363.4627
        },
        {
          "maxWeekly": 99999999999,
          "a": 0.47,
          "b": 655.7704
        }
      ]
    },
    "scale2Stsl": {
      "effectiveFrom": "2026-07-01",
      "verified": null,
      "bands": [
        {
          "maxWeekly": 362,
          "a": 0,
          "b": 0
        },
        {
          "maxWeekly": 538,
          "a": 0.15,
          "b": 54.3462
        },
        {
          "maxWeekly": 673,
          "a": 0.25,
          "b": 108.2135
        },
        {
          "maxWeekly": 721,
          "a": 0.17,
          "b": 54.3473
        },
        {
          "maxWeekly": 865,
          "a": 0.179,
          "b": 60.8377
        },
        {
          "maxWeekly": 1282,
          "a": 0.3227,
          "b": 185.1935
        },
        {
          "maxWeekly": 1337,
          "a": 0.32,
          "b": 181.7319
        },
        {
          "maxWeekly": 2494,
          "a": 0.47,
          "b": 382.2935
        },
        {
          "maxWeekly": 2596,
          "a": 0.49,
          "b": 432.1846
        },
        {
          "maxWeekly": 3577,
          "a": 0.56,
          "b": 613.9154
        },
        {
          "maxWeekly": 3653,
          "a": 0.49,
          "b": 363.4627
        },
        {
          "maxWeekly": 99999999999,
          "a": 0.57,
          "b": 655.7704
        }
      ]
    },
    "scale1": {
      "effectiveFrom": "2026-07-01",
      "verified": null,
      "bands": [
        {
          "maxWeekly": 188,
          "a": 0.15,
          "b": 0.15
        },
        {
          "maxWeekly": 371,
          "a": 0.2084,
          "b": 11.0185
        },
        {
          "maxWeekly": 515,
          "a": 0.179,
          "b": 0.1066
        },
        {
          "maxWeekly": 932,
          "a": 0.3227,
          "b": 74.1674
        },
        {
          "maxWeekly": 2246,
          "a": 0.32,
          "b": 71.6508
        },
        {
          "maxWeekly": 3303,
          "a": 0.39,
          "b": 228.8816
        },
        {
          "maxWeekly": 99999999999,
          "a": 0.47,
          "b": 493.1893
        }
      ]
    }
  },
  "annual": {
    "resident": {
      "effectiveFrom": "2020-07-01",
      "verified": {
        "on": "2026-08-30",
        "matches": true,
        "url": "https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents",
        "note": "15c band 18,201-45,000; 4,020+30c; 31,020+37c; 51,370+45c — row edited in place, date not bumped"
      },
      "bands": [
        {
          "maxCents": 1820000,
          "baseCents": 0,
          "rate": 0,
          "overCents": 0
        },
        {
          "maxCents": 4500000,
          "baseCents": 0,
          "rate": 0.15,
          "overCents": 1820000
        },
        {
          "maxCents": 13500000,
          "baseCents": 402000,
          "rate": 0.3,
          "overCents": 4500000
        },
        {
          "maxCents": 19000000,
          "baseCents": 3102000,
          "rate": 0.37,
          "overCents": 13500000
        },
        {
          "maxCents": 9999999999900,
          "baseCents": 5137000,
          "rate": 0.45,
          "overCents": 19000000
        }
      ]
    },
    "lito": {
      "effectiveFrom": "2020-07-01",
      "verified": {
        "on": "2026-08-30",
        "matches": true,
        "url": "https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset",
        "note": "700 to 37,500; -5c to 45,000; 325 -1.5c to 66,667 — row edited in place"
      },
      "bands": [
        {
          "maxCents": 3750000,
          "baseCents": 70000,
          "rate": 0,
          "overCents": 0
        },
        {
          "maxCents": 4500000,
          "baseCents": 70000,
          "rate": -0.05,
          "overCents": 3750000
        },
        {
          "maxCents": 6666700,
          "baseCents": 32500,
          "rate": -0.015,
          "overCents": 4500000
        },
        {
          "maxCents": 9999999999900,
          "baseCents": 0,
          "rate": 0,
          "overCents": 0
        }
      ]
    },
    "medicare": {
      "effectiveFrom": "2025-07-01",
      "verified": {
        "on": "2026-08-30",
        "matches": true,
        "url": "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners",
        "note": "singles 28,011 / 35,013 — current"
      },
      "bands": [
        {
          "maxCents": 2801100,
          "baseCents": 0,
          "rate": 0,
          "overCents": 0
        },
        {
          "maxCents": 3501300,
          "baseCents": 0,
          "rate": 0.1,
          "overCents": 2801100
        },
        {
          "maxCents": 9999999999900,
          "baseCents": 0,
          "rate": 0.02,
          "overCents": 0
        }
      ]
    },
    "help": {
      "effectiveFrom": "2026-07-01",
      "verified": null,
      "bands": [
        {
          "maxCents": 6952800,
          "baseCents": 0,
          "rate": 0,
          "overCents": 0
        },
        {
          "maxCents": 12971700,
          "baseCents": 0,
          "rate": 0.15,
          "overCents": 6952800
        },
        {
          "maxCents": 18605000,
          "baseCents": 902800,
          "rate": 0.17,
          "overCents": 12971700
        },
        {
          "maxCents": 9999999999900,
          "baseCents": 0,
          "rate": 0.1,
          "overCents": 0
        }
      ]
    },
    "mlsSingle": {
      "effectiveFrom": "2025-07-01",
      "verified": {
        "on": "2026-08-30",
        "matches": false,
        "url": "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates",
        "note": "CDN gives 101k/118k/158k; published 2026-27 is 105k/123k/164k — OVERRIDDEN in `manual`"
      },
      "bands": [
        {
          "maxCents": 10100000,
          "baseCents": 0,
          "rate": 0,
          "overCents": 0
        },
        {
          "maxCents": 11800000,
          "baseCents": 0,
          "rate": 0.01,
          "overCents": 0
        },
        {
          "maxCents": 15800000,
          "baseCents": 0,
          "rate": 0.0125,
          "overCents": 0
        },
        {
          "maxCents": 9999999999900,
          "baseCents": 0,
          "rate": 0.015,
          "overCents": 0
        }
      ]
    },
    "mlsFamily": {
      "effectiveFrom": "2025-07-01",
      "verified": {
        "on": "2026-08-30",
        "matches": false,
        "url": "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates",
        "note": "CDN gives 202k/236k/316k; published 2026-27 is 210k/246k/328k — OVERRIDDEN in `manual`"
      },
      "bands": [
        {
          "maxCents": 20200000,
          "baseCents": 150000,
          "rate": 0,
          "overCents": 0
        },
        {
          "maxCents": 23600000,
          "baseCents": 150000,
          "rate": 0.01,
          "overCents": 0
        },
        {
          "maxCents": 31600000,
          "baseCents": 150000,
          "rate": 0.0125,
          "overCents": 0
        },
        {
          "maxCents": 9999999999900,
          "baseCents": 150000,
          "rate": 0.015,
          "overCents": 0
        }
      ]
    }
  },
  "manual": {
    "medicareRate": {
      "value": 0.02,
      "source": "https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents"
    },
    "standardDeductionCents": {
      "value": 100000,
      "source": "https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/standard-deduction-for-work-related-expenses"
    },
    "superGuaranteeRate": {
      "value": 0.12,
      "source": "https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds/super-guarantee"
    },
    "mlsSingleOverride": {
      "value": [
        {
          "maxCents": 10500000,
          "rate": 0
        },
        {
          "maxCents": 12300000,
          "rate": 0.01
        },
        {
          "maxCents": 16400000,
          "rate": 0.0125
        },
        {
          "maxCents": 9007199254740991,
          "rate": 0.015
        }
      ],
      "source": "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates"
    },
    "mlsFamilyOverride": {
      "value": [
        {
          "maxCents": 21000000,
          "rate": 0
        },
        {
          "maxCents": 24600000,
          "rate": 0.01
        },
        {
          "maxCents": 32800000,
          "rate": 0.0125
        },
        {
          "maxCents": 9007199254740991,
          "rate": 0.015
        }
      ],
      "perExtraChildCents": 150000,
      "source": "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates"
    }
  }
};
