import { askMemory } from "../src/lib/memory/ask-memory";

const ctx = {
  accountId: "acct-apex",
  accountName: "Apex Roofing",
  workItemId: "wi-1",
  pagePath: "/accounts/acct-apex",
  globalQuery: null,
};

const ok = askMemory("What account is this?", ctx, {});
if (ok.kind !== "answer" || !ok.answer.includes("Apex")) {
  console.error("FAIL  account grounding", ok);
  process.exit(1);
}

const refuse = askMemory("What's the weather?", ctx, {});
if (refuse.kind !== "refusal") {
  console.error("FAIL  should refuse weather", refuse);
  process.exit(1);
}

console.log("PASS  ask memory grounding + refusal");
console.log("\nAll ask-memory checks passed.");
