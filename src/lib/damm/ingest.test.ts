import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseData360Latest, parseOwidLatest, ingestQueue } from "./ingest.ts";
import { sourceFor } from "./sources.ts";
import { model } from "./model.ts";

describe("Data360 parser", () => {
  const body = {
    value: [
      {
        OBS_VALUE: "87424454",
        TIME_PERIOD: "2024",
        LATEST_DATA: true,
        SEX: "_Z",
        AGE: "_Z",
        COMP_BREAKDOWN_1: "_Z",
        COMP_BREAKDOWN_2: "_Z",
        COMP_BREAKDOWN_3: "_Z",
        UNIT_MEASURE: "SB",
      },
      {
        OBS_VALUE: "72.281528",
        TIME_PERIOD: "2024",
        LATEST_DATA: true,
        SEX: "_Z",
        AGE: "_Z",
        COMP_BREAKDOWN_1: "_Z",
        COMP_BREAKDOWN_2: "_Z",
        COMP_BREAKDOWN_3: "_Z",
        UNIT_MEASURE: "SB_10P2_HB",
      },
      {
        OBS_VALUE: "66.9",
        TIME_PERIOD: "2023",
        LATEST_DATA: false,
        SEX: "_Z",
        AGE: "_Z",
        COMP_BREAKDOWN_1: "_Z",
        COMP_BREAKDOWN_2: "_Z",
        COMP_BREAKDOWN_3: "_Z",
        UNIT_MEASURE: "SB_10P2_HB",
      },
      {
        OBS_VALUE: "null",
        TIME_PERIOD: "2024",
        LATEST_DATA: true,
        SEX: "_T",
        AGE: "Y_GE15",
        COMP_BREAKDOWN_1: "_T",
        COMP_BREAKDOWN_2: "_T",
        COMP_BREAKDOWN_3: "_T",
        UNIT_MEASURE: "PT_RESP",
      },
      {
        OBS_VALUE: "12.4",
        TIME_PERIOD: "2024",
        LATEST_DATA: true,
        SEX: "F",
        AGE: "Y_GE15",
        COMP_BREAKDOWN_1: "_T",
        COMP_BREAKDOWN_2: "_T",
        COMP_BREAKDOWN_3: "_T",
        UNIT_MEASURE: "PT_RESP",
      },
      {
        OBS_VALUE: "15.61",
        TIME_PERIOD: "2024",
        LATEST_DATA: true,
        SEX: "_T",
        AGE: "Y_GE15",
        COMP_BREAKDOWN_1: "_T",
        COMP_BREAKDOWN_2: "_T",
        COMP_BREAKDOWN_3: "_T",
        UNIT_MEASURE: "PT_RESP",
      },
      {
        OBS_VALUE: "40.1",
        TIME_PERIOD: "2024",
        LATEST_DATA: true,
        SEX: "_T",
        AGE: "Y_GE15",
        COMP_BREAKDOWN_1: "Q1",
        COMP_BREAKDOWN_2: "_T",
        COMP_BREAKDOWN_3: "_T",
        UNIT_MEASURE: "PT_RESP",
      },
    ],
  };

  it("filters unit so an absolute count cannot masquerade as a per-100 rate", () => {
    assert.deepEqual(parseData360Latest(body, { unit: "SB_10P2_HB" }), { value: 72.281528, year: 2024 });
  });

  it("takes the latest total, not a sex or income slice", () => {
    assert.deepEqual(parseData360Latest(body, { sex: "_T", age: "Y_GE15", unit: "PT_RESP" }), {
      value: 15.61,
      year: 2024,
    });
  });

  it("skips OBS_VALUE null strings", () => {
    const onlyNull = {
      value: [{ OBS_VALUE: "null", TIME_PERIOD: "2024", SEX: "_T", UNIT_MEASURE: "PT_RESP", LATEST_DATA: true }],
    };
    assert.equal(parseData360Latest(onlyNull, { sex: "_T" }), null);
  });
});

describe("OWID parser", () => {
  it("takes the latest year for the requested ISO3", () => {
    const csv = [
      "Entity,Code,Year,mean_years_of_schooling",
      "Egypt,EGY,2010,7.15",
      "Egypt,EGY,2020,8.01",
      "France,FRA,2020,11.4",
    ].join("\n");
    assert.deepEqual(parseOwidLatest(csv, "EGY"), { value: 8.01, year: 2020 });
    assert.equal(parseOwidLatest(csv, "BTN"), null);
  });
});

describe("source cascade", () => {
  it("lists official exact series before documented proxies and research fallbacks", () => {
    const queue = ingestQueue();
    assert.equal(queue.length, model.indicators.length);
    const fetchable = queue.filter((s) => s.kind !== "named-gap");
    assert.ok(fetchable.length >= 20);
    const itu = ["2.1", "2.2", "2.3", "2.5"];
    for (const id of itu) {
      const spec = sourceFor(id);
      assert.equal(spec?.kind, "data360");
      assert.equal(spec?.databaseId, "ITU_DH");
    }
    assert.equal(sourceFor("2.3")?.data360Unit, "SB_10P2_HB");
    assert.equal(sourceFor("2.5")?.data360Unit, "PT_GNI_PS");
    assert.equal(sourceFor("2.3")?.fallbacks?.[0]?.kind, "worldbank");
    assert.equal(sourceFor("5.1")?.fallbacks?.[0]?.kind, "owid");
    assert.equal(sourceFor("3.1")?.data360Indicator, "UN_EGDI_EGDI");
    assert.equal(sourceFor("4.2")?.data360Indicator, "ITU_GCI_GCI_OVRL_SCRE");
    assert.equal(sourceFor("8.4")?.data360Indicator, "WB_FINDEX_MOBILEACCOUNT_T_D");
    assert.equal(sourceFor("4.7")?.data360Indicator, "E_ID");
    assert.equal(sourceFor("5.3")?.kind, "data360");
    assert.equal(sourceFor("5.3")?.data360Indicator, "UNESCO_UIS_GRAD_STEM");
    assert.equal(sourceFor("5.3")?.fallbacks?.[0]?.kind, "worldbank");
  });
});
