import {
  getServiceTemplate,
  lintPlaceholders,
} from "../src/lib/templates-registry";

const tmpl = getServiceTemplate("tmpl-cure-chase-v1");
if (!tmpl) {
  console.error("FAIL  missing cure template");
  process.exit(1);
}
const lint = lintPlaceholders(tmpl, {
  account_name: "A",
  contact_name: "B",
  cure_item: "payment",
  cancel_date: "Aug 15",
});
if (lint.missing.length !== 0) {
  console.error("FAIL  unexpected missing", lint.missing);
  process.exit(1);
}
console.log("PASS  composer placeholder lint");
console.log("\nAll composer checks passed.");
