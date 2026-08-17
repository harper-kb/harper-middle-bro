import { describe, expect, it } from "vitest";
import {
  accountMatchesLocationStates,
  isLocationStateFilterId,
  LOCATION_STATE_NONE,
  LOCATION_STATE_NONE_LABEL,
  locationStateLabel,
  normalizeLocationState,
  parseLocationStates,
  serializeLocationStates,
  US_STATE_CODES,
  US_STATE_NAMES,
} from "@/lib/location-state";

/**
 * Location State filter axis. The vocabulary is the fixed USPS code set and
 * the normalizer is the same one the book refresh writes `accounts.state`
 * with, so filter membership and the value each row displays can never
 * disagree. Verified live shapes this pins: codes and full names both arrive
 * from Harper ("FL" and "Florida"), a handful of rows carry names with
 * trailing punctuation ("Georgia."), and missing states are real.
 */

describe("normalizeLocationState", () => {
  it("folds two-letter codes to upper case", () => {
    expect(normalizeLocationState("ca")).toBe("CA");
    expect(normalizeLocationState(" fl ")).toBe("FL");
    expect(normalizeLocationState("DC")).toBe("DC");
  });

  it("maps full names, including live trailing-punctuation strays", () => {
    expect(normalizeLocationState("Florida")).toBe("FL");
    expect(normalizeLocationState("district of columbia")).toBe("DC");
    expect(normalizeLocationState("Massachusetts.")).toBe("MA");
    expect(normalizeLocationState("Georgia.")).toBe("GA");
    expect(normalizeLocationState("New  York")).toBe("New  York"); // not exact — stays itself
  });

  it("passes unknown values through untouched rather than guessing", () => {
    expect(normalizeLocationState("Somewhere")).toBe("Somewhere");
    expect(normalizeLocationState("")).toBe("");
    expect(normalizeLocationState(null)).toBe("");
    expect(normalizeLocationState(undefined)).toBe("");
  });
});

describe("state vocabulary", () => {
  it("covers the fifty states, DC and the USPS territories", () => {
    expect(US_STATE_CODES).toHaveLength(56);
    expect(US_STATE_CODES).toContain("DC");
    expect(US_STATE_CODES).toContain("PR");
    expect(US_STATE_NAMES.CA).toBe("California");
    expect([...US_STATE_CODES].sort()).toEqual([...US_STATE_CODES]);
  });

  it("recognizes codes and the none id, nothing else", () => {
    expect(isLocationStateFilterId("CA")).toBe(true);
    expect(isLocationStateFilterId(LOCATION_STATE_NONE)).toBe(true);
    expect(isLocationStateFilterId("ZZ")).toBe(false);
    expect(isLocationStateFilterId("California")).toBe(false);
  });

  it("labels ids with full names and the explicit Unknown wording", () => {
    expect(locationStateLabel("NY")).toBe("New York");
    expect(locationStateLabel(LOCATION_STATE_NONE)).toBe(
      LOCATION_STATE_NONE_LABEL,
    );
    expect(locationStateLabel(LOCATION_STATE_NONE)).toBe("Unknown / Not set");
  });
});

describe("parseLocationStates / serializeLocationStates", () => {
  it("round-trips a selection through the URL param", () => {
    expect(parseLocationStates("CA,NY")).toEqual(["CA", "NY"]);
    expect(serializeLocationStates(["CA", "NY"])).toBe("CA,NY");
    expect(
      parseLocationStates(serializeLocationStates(["NY", LOCATION_STATE_NONE, "CA"])),
    ).toEqual(["CA", "NY", LOCATION_STATE_NONE]);
  });

  it("canonicalizes case, names, duplicates and order — Unknown last", () => {
    expect(parseLocationStates("ny,Florida,NY, ca ")).toEqual([
      "CA",
      "FL",
      "NY",
    ]);
    expect(serializeLocationStates([LOCATION_STATE_NONE, "NY", "CA"])).toBe(
      `CA,NY,${LOCATION_STATE_NONE}`,
    );
  });

  it("safely rejects unknown codes and junk", () => {
    expect(parseLocationStates("ZZ,teapot,CA")).toEqual(["CA"]);
    expect(parseLocationStates("ZZ")).toEqual([]);
    expect(parseLocationStates("")).toEqual([]);
    expect(parseLocationStates(undefined)).toEqual([]);
    expect(serializeLocationStates([])).toBeUndefined();
  });
});

describe("accountMatchesLocationStates", () => {
  it("matches recognized codes with OR semantics", () => {
    expect(accountMatchesLocationStates("CA", ["CA", "NY"])).toBe(true);
    expect(accountMatchesLocationStates("FL", ["CA", "NY"])).toBe(false);
    expect(accountMatchesLocationStates("CA", [])).toBe(true);
  });

  it("sends missing and unrecognized values to Unknown / Not set only", () => {
    expect(accountMatchesLocationStates("", [LOCATION_STATE_NONE])).toBe(true);
    expect(accountMatchesLocationStates(null, [LOCATION_STATE_NONE])).toBe(true);
    expect(
      accountMatchesLocationStates("Massachusetts.", [LOCATION_STATE_NONE]),
    ).toBe(true);
    // …and never to a real state.
    expect(accountMatchesLocationStates("Massachusetts.", ["MA"])).toBe(false);
    expect(accountMatchesLocationStates("", ["CA"])).toBe(false);
    expect(accountMatchesLocationStates("CA", [LOCATION_STATE_NONE])).toBe(
      false,
    );
  });
});
