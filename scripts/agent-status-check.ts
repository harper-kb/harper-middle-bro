import {
  projectHumanTasks,
  summarizeAgentStatus,
} from "../src/lib/agent-status/projection";

const tasks = projectHumanTasks([
  {
    id: "1",
    workItemId: "a",
    accountId: "x",
    title: "Running",
    status: "running",
    blockedReason: null,
    reminderAt: null,
    updatedAt: "2026-08-10T12:00:00.000Z",
  },
  {
    id: "2",
    workItemId: "b",
    accountId: "y",
    title: "Need human",
    status: "waiting_human",
    blockedReason: null,
    reminderAt: "2026-08-10T18:00:00.000Z",
    updatedAt: "2026-08-10T11:00:00.000Z",
  },
  {
    id: "3",
    workItemId: "c",
    accountId: "z",
    title: "Blocked",
    status: "blocked",
    blockedReason: "Missing payment link door",
    reminderAt: null,
    updatedAt: "2026-08-10T10:00:00.000Z",
  },
]);

if (tasks[0].status !== "waiting_human") {
  console.error("FAIL  waiting_human should sort first", tasks);
  process.exit(1);
}
const summary = summarizeAgentStatus(tasks);
if (!summary.includes("1 waiting") || !summary.includes("1 blocked")) {
  console.error("FAIL  summary", summary);
  process.exit(1);
}
console.log("PASS  agent status projection");
console.log("\nAll agent-status checks passed.");
