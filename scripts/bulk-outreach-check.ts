import { filterBulkRecipients } from "../src/lib/actions/bulk-filter";

const email = filterBulkRecipients(
  [
    { accountId: "a", workItemId: "1", to: "a@x.com" },
    {
      accountId: "b",
      workItemId: "2",
      to: "b@x.com",
      excluded: true,
      excludeReason: "opt out",
    },
    { accountId: "c", workItemId: null, to: "bad" },
    { accountId: "d", workItemId: null, to: "+15551234567" },
  ],
  "email",
);

if (email.included.length !== 1 || email.excluded.length !== 3) {
  console.error("FAIL  email bulk filter counts", email);
  process.exit(1);
}
console.log("PASS  email bulk filter");

const text = filterBulkRecipients(
  [
    { accountId: "a", workItemId: "1", to: "a@x.com" },
    { accountId: "d", workItemId: null, to: "+15551234567" },
    { accountId: "e", workItemId: null, to: "555-999-0000" },
    { accountId: "f", workItemId: null, to: "123" },
  ],
  "text",
);

if (text.included.length !== 2 || text.excluded.length !== 2) {
  console.error("FAIL  text bulk filter counts", text);
  process.exit(1);
}
console.log("PASS  text bulk filter");
console.log("\nAll bulk-outreach checks passed.");
