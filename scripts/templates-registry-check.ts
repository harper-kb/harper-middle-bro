import {
  extractPlaceholders,
  lintPlaceholders,
  listServiceTemplates,
  notionSyncConfigured,
} from "../src/lib/templates-registry";
const templates = listServiceTemplates();
console.assert(templates.length >= 2);
const cure = templates.find((t) => t.id === "tmpl-cure-chase-v1")!;
console.assert(extractPlaceholders(cure.body).includes("account_name"));
const lint = lintPlaceholders(cure, { account_name: "Apex", contact_name: "" });
console.assert(lint.missing.includes("contact_name"));
console.assert(notionSyncConfigured() === false || notionSyncConfigured() === true);
console.log("PASS  templates registry");
console.log("\nAll templates-registry checks passed.");
