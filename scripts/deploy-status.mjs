#!/usr/bin/env node
/**
 * What is actually live, per Railway project.
 *
 * Run: node scripts/deploy-status.mjs
 *
 * Two Railway projects build this repo, so "did it deploy?" has more than one
 * answer, and the newest deployment record is not necessarily the one serving
 * the domain you are looking at.
 *
 * The status history is also easy to misread. Railway retires the previous
 * deployment when a new one goes live by marking it failure and then
 * inactive, so nearly every healthy deploy ends its life carrying a
 * `failure`:
 *
 *   in_progress -> success -> failure -> inactive
 *                             ^ the moment the NEXT deploy went live
 *
 * A real build failure looks different: it starts (in_progress) and then
 * fails without ever succeeding. A record that is born failed, with no
 * in_progress at all, never built anything — it is the marker GitHub writes
 * when a project retires an older deployment.
 *
 * This reports the newest deployment per environment that actually reached
 * success, names genuine failures separately, and prints the Railway project
 * behind each environment so two labels for one project are visible.
 */

import { execFileSync } from "node:child_process";

const REPO = process.env.REPO ?? "harper-kb/harper-middle-bro";
const LOOKBACK = 25;

const gh = (path) =>
  JSON.parse(
    execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path], {
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  );

const short = (sha) => (sha ?? "").slice(0, 7);

/** The Railway project id out of a status's environment_url, when present. */
const projectOf = (statuses) => {
  for (const s of statuses) {
    const m = /\/project\/([0-9a-f-]{8})/.exec(s.environment_url ?? "");
    if (m) return m[1];
  }
  return null;
};

const deployments = gh(`repos/${REPO}/deployments?per_page=100`);
if (deployments.length === 0) {
  console.log("No deployments on this repository.");
  process.exit(0);
}

// Environment → its deployments, newest first (the API already returns that).
const byEnv = new Map();
for (const d of deployments) {
  if (!byEnv.has(d.environment)) byEnv.set(d.environment, []);
  byEnv.get(d.environment).push(d);
}

let head = "unknown";
try {
  head = short(
    execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf-8" }).trim(),
  );
} catch {
  /* not a checkout, or no origin/main — the report still stands */
}

console.log(`Repo: ${REPO}`);
console.log(`main: ${head}\n`);

const live = [];
for (const [env, list] of byEnv) {
  let current = null;
  const realFailures = [];

  for (const d of list.slice(0, LOOKBACK)) {
    const statuses = gh(`repos/${REPO}/deployments/${d.id}/statuses`).reverse();
    const states = statuses.map((s) => s.state); // oldest first
    const succeeded = states.includes("success");
    if (succeeded && !current) {
      current = {
        ref: short(d.ref),
        at: d.created_at,
        id: d.id,
        project: projectOf(statuses),
      };
    }
    // Started, then failed, and never succeeded. A record with no
    // in_progress never ran a build — that is a retirement marker.
    if (!succeeded && states.includes("failure") && states.includes("in_progress")) {
      realFailures.push(`${d.id} ${short(d.ref)} ${d.created_at}`);
    }
  }

  console.log(env);
  if (current) {
    const stale = current.ref !== head && head !== "unknown";
    console.log(
      `  live   ${current.ref}${stale ? "   ← BEHIND main" : ""}   (deploy ${current.id}, ${current.at})`,
    );
    if (current.project) console.log(`  railway project ${current.project}…`);
    live.push({ env, ref: current.ref, project: current.project });
  } else {
    console.log(`  live   nothing succeeded in the last ${LOOKBACK} deployments`);
  }
  if (realFailures.length > 0) {
    console.log("  builds that failed without ever succeeding:");
    for (const f of realFailures) console.log(`    ${f}`);
  } else {
    console.log("  no genuine build failures (retirement markers ignored)");
  }
  console.log();
}

const refs = new Set(live.map((l) => l.ref));
if (refs.size > 1) {
  console.log(
    `Environments disagree: ${live.map((l) => `${l.env}=${l.ref}`).join(", ")}`,
  );
}

// Two environment names pointing at one Railway project means the service was
// renamed; the old label lingers and looks like a target that has fallen
// behind. Two DIFFERENT projects means every push builds twice.
const byProject = new Map();
for (const l of live) {
  if (!l.project) continue;
  if (!byProject.has(l.project)) byProject.set(l.project, []);
  byProject.get(l.project).push(l.env);
}
for (const [project, names] of byProject) {
  if (names.length > 1) {
    console.log(
      `\n${names.join(" and ")} are the same Railway project (${project}…) — a rename, not two targets.`,
    );
  }
}
if (byProject.size > 1) {
  console.log(
    `\n${byProject.size} separate Railway projects build this repo. Every merge builds ${byProject.size} times, and "is it live?" has ${byProject.size} answers.`,
  );
}
