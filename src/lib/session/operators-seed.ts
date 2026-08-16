import { buildSignature } from "./signature";
import type { Operator } from "../types";

const RAW: Omit<Operator, "signature">[] = [
  {
    id: "op-dakotah",
    clerkUserId: null,
    displayName: "Dakotah Rice",
    email: "dakotah.rice@harperinsure.com",
    title: "Desk Manager",
    phone: "470-839-4314",
    role: "manager",
    team: null,
    defaultTemplate: "standard",
  },
  {
    id: "op-tanya",
    clerkUserId: null,
    displayName: "Tanya Osei",
    email: "tanya.osei@harperinsure.com",
    title: "COI Lead",
    phone: "415-555-0171",
    role: "operator",
    team: "COI Team",
    defaultTemplate: "standard",
  },
  {
    id: "op-moiz",
    clerkUserId: null,
    displayName: "Moiz Qureshi",
    email: "moiz.qureshi@harperinsure.com",
    title: "COI Specialist",
    phone: "415-555-0172",
    role: "operator",
    team: "COI Team",
    defaultTemplate: "brief",
  },
  {
    id: "op-muneeb",
    clerkUserId: null,
    displayName: "Muneeb Ahmed",
    email: "muneeb.ahmed@harperinsure.com",
    title: "COI Specialist",
    phone: "415-555-0173",
    role: "operator",
    team: "COI Team",
    defaultTemplate: "standard",
  },
  {
    id: "op-razaq",
    clerkUserId: null,
    displayName: "Razaq Adebayo",
    email: "razaq.adebayo@harperinsure.com",
    title: "COI Specialist",
    phone: "415-555-0174",
    role: "operator",
    team: "COI Team",
    defaultTemplate: "brief",
  },
  {
    id: "op-riley",
    clerkUserId: null,
    displayName: "Riley Chen",
    email: "riley.chen@harperinsure.com",
    title: "Commercial Lines Service",
    phone: "415-555-0142",
    role: "operator",
    team: null,
    defaultTemplate: "standard",
  },
  {
    id: "op-morgan",
    clerkUserId: null,
    displayName: "Morgan Lee",
    email: "morgan.lee@harperinsure.com",
    title: "CSR · Endorsements",
    phone: "415-555-0188",
    role: "operator",
    team: null,
    defaultTemplate: "brief",
  },
  {
    id: "op-casey",
    clerkUserId: null,
    displayName: "Casey Nguyen",
    email: "casey.nguyen@harperinsure.com",
    title: "Account Manager",
    phone: "415-555-0160",
    role: "operator",
    team: null,
    defaultTemplate: "formal",
  },
];

/** Desk operators — sign in, customize signature, close their tasks. */
export const SEED_OPERATORS: Operator[] = RAW.map((o) => ({
  ...o,
  signature: buildSignature(o),
}));

/**
 * The manager's opening book split. Tanya (COI Lead) carries the cert-heavy
 * accounts; the rest of the COI team splits the book. Grants live in
 * operator_accounts and are manager-editable at runtime — this is only the
 * starting state.
 */
export const SEED_ACCOUNT_GRANTS: { operatorId: string; accountIds: string[] }[] = [
  {
    operatorId: "op-tanya",
    accountIds: [
      "acct-greenleaf",
      "acct-summit",
      "acct-craft",
      "acct-meridian",
      "acct-northstar",
    ],
  },
  {
    operatorId: "op-moiz",
    accountIds: ["acct-apex", "acct-ridgeline", "acct-pixel", "acct-metro"],
  },
  {
    operatorId: "op-muneeb",
    accountIds: ["acct-harbor", "acct-cedar", "acct-oakridge", "acct-beacon"],
  },
  {
    operatorId: "op-razaq",
    accountIds: [
      "acct-redwood",
      "acct-lakeside",
      "acct-ironclad",
      "acct-bright",
    ],
  },
];
