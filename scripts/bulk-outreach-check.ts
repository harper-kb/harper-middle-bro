import { filterBulkRecipients } from "../src/lib/actions/bulk-filter";

const { included, excluded } = filterBulkRecipients([
  { accountId: "a", workItemId: "1", to: "a@x.com" },
  {
    accountId: "b",
    workItemId: "2",
    to: "b@x.com",
    excluded: true,
    excludeReason: "opt out",
  },
  { accountId: "c", workItemId: null, to: "bad" },
]);

if (included.length !== 1 || excluded.length !== 2) {
  console.error("FAIL  bulk filter counts", { included, excluded });
  process.exit(1);
}
console.log("PASS  bulk filter");
console.log("\nAll bulk-outreach checks passed.");
