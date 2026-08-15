#!/usr/bin/env node
/**
 * Push the packed real book onto a Railway service and redeploy.
 *
 *   node scripts/pack-harper-book.mjs            # writes data/harper-book-env.txt
 *   RAILWAY_TOKEN=... node scripts/deploy-book-to-railway.mjs --service harper-step-bro
 *
 * The book is real customer data and stays out of git, so it cannot ride
 * in with a commit. This carries it over the Railway API instead: the
 * variables are set on the service, then the service is redeployed once so
 * it boots from them.
 *
 * Flags:
 *   --service <name>       required unless the account has exactly one
 *   --project <name>       required only to disambiguate
 *   --environment <name>   default "production"
 *   --dry-run              resolve and report, change nothing
 *
 * Auth: RAILWAY_TOKEN (account or team token) or RAILWAY_PROJECT_TOKEN.
 *
 * Never logs a variable value or the token. A book is customer data and a
 * deploy log is not a place to put it.
 */

import fs from "node:fs";
import path from "node:path";

const API = "https://backboard.railway.app/graphql/v2";
const ENV_FILE = path.join(process.cwd(), "data", "harper-book-env.txt");

function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes("--dry-run");
const wantService = flag("service");
const wantProject = flag("project");
const wantEnv = flag("environment", "production");

const accountToken = process.env.RAILWAY_TOKEN;
const projectToken = process.env.RAILWAY_PROJECT_TOKEN;
if (!accountToken && !projectToken) {
  console.error(
    "No credential. Set RAILWAY_TOKEN (account/team) or RAILWAY_PROJECT_TOKEN.",
  );
  process.exit(1);
}
const authHeader = accountToken
  ? { Authorization: `Bearer ${accountToken}` }
  : { "Project-Access-Token": projectToken };

async function gql(query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`Railway returned ${res.status} with no JSON body`);
  if (body.errors?.length) {
    const msg = body.errors.map((e) => e.message).join("; ");
    // "Not Authorized" here almost always means the token is missing the
    // scope for this project rather than that the token is malformed.
    throw new Error(`Railway: ${msg}`);
  }
  return body.data;
}

function readVariables() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(
      `No packed book at ${ENV_FILE}.\nRun: node scripts/pack-harper-book.mjs`,
    );
    process.exit(1);
  }
  const vars = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    vars[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return vars;
}

const DISCOVER = `{
  me {
    projects { edges { node {
      id name
      environments { edges { node { id name } } }
      services { edges { node { id name } } }
    } } }
  }
}`;

function pick(kind, nodes, want) {
  if (want) {
    const hit = nodes.filter((n) => n.name === want);
    if (hit.length === 1) return hit[0];
    if (hit.length === 0) {
      console.error(
        `No ${kind} named "${want}". Available: ${nodes.map((n) => n.name).join(", ") || "(none)"}`,
      );
      process.exit(1);
    }
    console.error(`Ambiguous ${kind} "${want}" — ${hit.length} matches.`);
    process.exit(1);
  }
  if (nodes.length === 1) return nodes[0];
  console.error(
    `Several ${kind}s; pass --${kind}. Available: ${nodes.map((n) => n.name).join(", ")}`,
  );
  process.exit(1);
}

async function main() {
  const variables = readVariables();
  const names = Object.keys(variables);
  const bytes = Object.values(variables).reduce((n, v) => n + v.length, 0);
  console.log(`book: ${names.length} variable(s), ${bytes} bytes — ${names.join(", ")}`);

  const data = await gql(DISCOVER);
  const projects = (data.me?.projects?.edges ?? []).map((e) => e.node);
  if (projects.length === 0) {
    console.error("This token can see no projects.");
    process.exit(1);
  }

  // Prefer the project that actually owns the requested service, so a
  // --service on its own is enough when the name is unique.
  let project = null;
  if (!wantProject && wantService) {
    const owning = projects.filter((p) =>
      (p.services?.edges ?? []).some((e) => e.node.name === wantService),
    );
    if (owning.length === 1) project = owning[0];
  }
  project ??= pick("project", projects, wantProject);

  const service = pick(
    "service",
    (project.services?.edges ?? []).map((e) => e.node),
    wantService,
  );
  const environment = pick(
    "environment",
    (project.environments?.edges ?? []).map((e) => e.node),
    wantEnv,
  );

  console.log(
    `target: ${project.name} / ${service.name} / ${environment.name}`,
  );
  if (DRY) {
    console.log("dry run — nothing changed.");
    return;
  }

  // No `replace`: this must add the book's variables and leave every other
  // variable on the service untouched. skipDeploys so the variables land in
  // one shot and a single redeploy follows, rather than one per write.
  await gql(
    `mutation($input: VariableCollectionUpsertInput!) {
       variableCollectionUpsert(input: $input)
     }`,
    {
      input: {
        projectId: project.id,
        environmentId: environment.id,
        serviceId: service.id,
        variables,
        skipDeploys: true,
      },
    },
  );
  console.log("variables set.");

  await gql(
    `mutation($environmentId: String!, $serviceId: String!) {
       serviceInstanceRedeploy(environmentId: $environmentId, serviceId: $serviceId)
     }`,
    { environmentId: environment.id, serviceId: service.id },
  );
  console.log("redeploy triggered.");
  console.log(
    "\nWhen it is up, the desk should show real accounts. Confirm with:\n" +
      "  node scripts/deploy-status.mjs",
  );
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
