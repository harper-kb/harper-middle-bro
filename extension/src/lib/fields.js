/**
 * The editable shape of a profile, and the defaults a fresh install starts from.
 *
 * These keys are the contract with src/inject/fill-engine.js. "Confirm account number" is
 * deliberately absent: the engine mirrors it from `accountNumber`, so there is nothing to
 * type twice and no way for the two to disagree.
 */

/** @typedef {"text" | "secret" | "choice" | "tristate"} FieldControl */

export const PROFILE_FIELDS = [
  {
    key: "accountHolderName",
    label: "Name of account holder",
    control: "text",
    placeholder: "Greenleaf Landscape LLC",
    autocomplete: "off",
  },
  {
    key: "accountHolderType",
    label: "Account holder type",
    control: "choice",
    options: ["Individual", "Company"],
  },
  {
    key: "accountType",
    label: "Account type",
    control: "choice",
    options: ["Checking", "Savings"],
  },
  {
    key: "accountNumber",
    label: "Account number",
    control: "secret",
    placeholder: "000123456789",
    hint: "Also fills the confirmation box.",
    numeric: true,
  },
  {
    key: "routingNumber",
    label: "Routing number",
    control: "secret",
    placeholder: "9 digits",
    numeric: true,
    maxLength: 9,
  },
  {
    key: "autopay",
    label: "Autopay",
    control: "tristate",
    onLabel: "On",
    offLabel: "Off",
  },
  {
    key: "terms",
    label: "Terms of Use checkbox",
    control: "tristate",
    onLabel: "Check",
    offLabel: "Uncheck",
    hint: "Checking the box accepts the site's terms on your behalf.",
  },
];

export const FIELD_LABELS = Object.fromEntries(
  PROFILE_FIELDS.map((field) => [field.key, field.label]),
);
FIELD_LABELS.confirmAccountNumber = "Confirm account number";

export function emptyValues() {
  return {
    accountHolderName: "",
    accountHolderType: "Individual",
    accountType: "Checking",
    accountNumber: "",
    routingNumber: "",
    // null means "leave whatever the page already has".
    autopay: null,
    terms: null,
  };
}

export function newProfile(name = "Default") {
  return {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    values: emptyValues(),
    customFields: [],
  };
}

/** Fields that carry a value the engine will actually try to place. */
export function readyCount(profile) {
  if (!profile) return 0;
  const values = profile.values || {};
  let count = 0;
  for (const field of PROFILE_FIELDS) {
    const value = values[field.key];
    if (value === null || value === undefined || value === "") continue;
    count += 1;
    // The confirmation box is a second real field on the page.
    if (field.key === "accountNumber") count += 1;
  }
  for (const custom of profile.customFields || []) {
    if (custom.match && custom.value) count += 1;
  }
  return count;
}

/**
 * Whether there is anything worth filling. The two dropdowns start on the values the payment
 * page itself defaults to, so they are not on their own evidence that anyone has set this up
 * — without this, a brand-new install would offer to "fill" a page with nothing but defaults.
 */
export function isReady(profile) {
  if (!profile) return false;
  const values = profile.values || {};
  const identifying = ["accountHolderName", "accountNumber", "routingNumber"];
  if (identifying.some((key) => values[key])) return true;
  return (profile.customFields || []).some((custom) => custom.match && custom.value);
}
