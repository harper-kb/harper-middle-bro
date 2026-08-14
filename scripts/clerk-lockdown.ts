/**
 * Lock the hosted desk down to invited people, in one command.
 *
 * Does three things against the Clerk Backend API:
 *   1. Restricts sign-up to the allowlist  (PATCH /beta_features/instance_settings
 *      `restricted_to_allowlist`, plus PATCH /instance/restrictions `allowlist`).
 *   2. Adds each allowed identifier         (POST /allowlist_identifiers).
 *   3. Invites each teammate                (POST /invitations, which sends the email).
 *
 * Then reads both lists back so the result is verified, not assumed.
 *
 * The Dashboard's "Restricted" sign-up mode toggle has no field in the Backend
 * API (checked against spec 2026-05-12). The allowlist pair above is the
 * API-supported equivalent: only listed identifiers can create an account.
 * If you want the Dashboard toggle as well, set it by hand under
 * Restrictions — it is belt and braces, not a substitute.
 *
 * Usage (a domain may be given as harperinsure.com, @harperinsure.com, or
 * *@harperinsure.com — all are normalized to the `*@` form Clerk accepts):
 *   export CLERK_SECRET_KEY=sk_test_...
 *   npx tsx scripts/clerk-lockdown.ts --allow harperinsure.com \
 *     --invite someone@harperinsure.com --invite other@harperinsure.com
 *
 * Prints a plan and changes nothing until you add --apply.
 */

// Overridable so the write path can be exercised against a stub instead of a
// live Clerk instance. Unset, it is the real thing.
const API = process.env.CLERK_API_BASE ?? "https://api.clerk.com/v1";

interface Args {
  allow: string[];
  invite: string[];
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { allow: [], invite: [], apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--apply") {
      args.apply = true;
    } else if (flag === "--allow" || flag === "--invite") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} needs a value.`);
      }
      (flag === "--allow" ? args.allow : args.invite).push(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

const secret = process.env.CLERK_SECRET_KEY;

async function call(
  method: "GET" | "PATCH" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/**
 * Clerk wants a whole-domain rule as `*@example.com`. It rejects both
 * `example.com` and `@example.com` with a 422 — verified against the live API
 * on 2026-08-11, and the bare-@ form is what this script used to send, so a
 * domain rule silently never landed.
 */
function normalizeIdentifier(raw: string): string {
  const value = raw.trim();
  if (value.includes("@") && !value.startsWith("@") && !value.startsWith("*@")) {
    return value; // someone@example.com
  }
  return `*@${value.replace(/^\*?@+/, "")}`;
}

/** A duplicate is a normal re-run; anything else rejected is a real failure. */
function isDuplicate(json: unknown): boolean {
  const summary = errorSummary(json).toLowerCase();
  return summary.includes("already") || summary.includes("duplicate");
}

function errorSummary(json: unknown): string {
  if (
    json &&
    typeof json === "object" &&
    "errors" in json &&
    Array.isArray((json as { errors: unknown[] }).errors)
  ) {
    return (json as { errors: { message?: string; long_message?: string }[] }).errors
      .map((e) => e.long_message ?? e.message ?? "unknown error")
      .join("; ");
  }
  return typeof json === "string" ? json : JSON.stringify(json);
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (!secret && args.apply) {
    console.error(
      "CLERK_SECRET_KEY is not set, so there is nothing to apply.\n" +
        "This repo's Clerk app may still be keyless — claim it first with\n" +
        "`npx clerk auth login`, then copy the secret key from the Clerk Dashboard\n" +
        "(API keys) and export it here. Drop --apply to see the plan without a key.",
    );
    return 1;
  }

  /** Anything an invited person signs up with also belongs on the allowlist. */
  const allowIdentifiers = [...new Set([...args.allow, ...args.invite])].map(
    normalizeIdentifier,
  );

  // Name the instance about to change, so nobody applies this to the wrong one.
  // A plan needs no key; applying does.
  if (secret) {
    const instance = await call("GET", "/instance");
    if (instance.status !== 200) {
      console.error(
        `Clerk rejected the secret key (HTTP ${instance.status}): ${errorSummary(instance.json)}`,
      );
      return 1;
    }
    const inst = instance.json as { id?: string; environment_type?: string };
    console.log(
      `Instance: ${inst.id ?? "unknown"} (${inst.environment_type ?? "unknown environment"})`,
    );
  } else {
    console.log("Instance: unknown (no CLERK_SECRET_KEY — planning offline)");
  }

  console.log(`Allowlist entries to add: ${allowIdentifiers.join(", ") || "(none)"}`);
  console.log(`Invitations to send:      ${args.invite.join(", ") || "(none)"}`);

  if (!args.apply) {
    console.log(
      "\nPlan only — nothing changed. Re-run with --apply to restrict sign-up," +
        " add the allowlist entries, and send the invitations.",
    );
    return 0;
  }

  let failures = 0;

  console.log("\n[1] Restricting sign-up to the allowlist");
  for (const [path, body, label] of [
    [
      "/beta_features/instance_settings",
      { restricted_to_allowlist: true },
      "restricted_to_allowlist = true",
    ],
    ["/instance/restrictions", { allowlist: true }, "allowlist = true"],
  ] as const) {
    const res = await call("PATCH", path, body);
    if (res.status >= 200 && res.status < 300) {
      console.log(`  ok  ${label}`);
    } else {
      failures += 1;
      console.error(`FAIL  ${label} — HTTP ${res.status}: ${errorSummary(res.json)}`);
    }
  }

  // Step [1] has already switched sign-up to allowlist-only. If an entry fails
  // to land now, the instance is left restricted to an allowlist that does not
  // contain the intended people — so a rejection here is fatal, never a shrug.
  console.log("\n[2] Allowlist identifiers");
  for (const identifier of allowIdentifiers) {
    const res = await call("POST", "/allowlist_identifiers", {
      identifier,
      notify: false,
    });
    if (res.status >= 200 && res.status < 300) {
      console.log(`  ok  ${identifier}`);
    } else if ((res.status === 400 || res.status === 422) && isDuplicate(res.json)) {
      console.log(`  --  ${identifier} (already allowed)`);
    } else {
      failures += 1;
      console.error(`FAIL  ${identifier} — HTTP ${res.status}: ${errorSummary(res.json)}`);
    }
  }

  console.log("\n[3] Invitations");
  for (const email of args.invite) {
    const res = await call("POST", "/invitations", { email_address: email });
    if (res.status >= 200 && res.status < 300) {
      console.log(`  ok  invited ${email}`);
    } else if (res.status === 400 || res.status === 422) {
      console.log(`  --  ${email} (already invited or already a user: ${errorSummary(res.json)})`);
    } else {
      failures += 1;
      console.error(`FAIL  ${email} — HTTP ${res.status}: ${errorSummary(res.json)}`);
    }
  }

  console.log("\n[4] Verifying against Clerk");
  const allowlist = await call("GET", "/allowlist_identifiers?limit=100");
  if (allowlist.status === 200) {
    const rows = (
      Array.isArray(allowlist.json)
        ? allowlist.json
        : ((allowlist.json as { data?: unknown[] })?.data ?? [])
    ) as { identifier?: string }[];
    const present = new Set(rows.map((r) => r.identifier));
    console.log(
      `  allowlist (${rows.length}): ${rows.map((r) => r.identifier).join(", ") || "(empty)"}`,
    );
    // Read back rather than trust the writes: an empty allowlist next to
    // "sign-up restricted" locks out the whole team, and the earlier version of
    // this script reported that state as success.
    for (const identifier of allowIdentifiers) {
      if (!present.has(identifier)) {
        failures += 1;
        console.error(`FAIL  ${identifier} is not in the allowlist after applying`);
      }
    }
    if (allowIdentifiers.length > 0 && rows.length === 0) {
      console.error(
        "FAIL  sign-up is restricted to an EMPTY allowlist — nobody can sign up, including staff.",
      );
    }
  } else {
    failures += 1;
    console.error(`FAIL  could not read the allowlist — HTTP ${allowlist.status}`);
  }

  const pending = await call("GET", "/invitations?status=pending&limit=100");
  if (pending.status === 200) {
    const rows = (
      Array.isArray(pending.json)
        ? pending.json
        : ((pending.json as { data?: unknown[] })?.data ?? [])
    ) as { email_address?: string }[];
    console.log(
      `  pending invitations (${rows.length}): ${rows.map((r) => r.email_address).join(", ") || "(none)"}`,
    );
  } else {
    failures += 1;
    console.error(`FAIL  could not read invitations — HTTP ${pending.status}`);
  }

  // Clerk is only the first gate. The app refuses to hand an operator to an
  // unlisted email too, and that gate reads env — so print exactly what to set.
  // Skipping this leaves accounts created before the lockdown still able to work.
  console.log("\n[5] Set these on the host, then redeploy");
  const domains = allowIdentifiers
    .filter((id) => id.startsWith("*@"))
    .map((id) => id.slice(2));
  const emails = allowIdentifiers.filter((id) => !id.startsWith("*@"));
  if (domains.length > 0) console.log(`  DESK_ALLOWED_DOMAINS=${domains.join(",")}`);
  if (emails.length > 0) console.log(`  DESK_ALLOWED_EMAILS=${emails.join(",")}`);
  if (domains.length === 0 && emails.length === 0) {
    console.log("  (nothing to set — no identifiers were requested)");
  }

  if (failures === 0) {
    console.log(
      "\nDone. The allowlist is enabled and contains exactly what was asked for." +
        "\n\nOne thing this cannot set: the Dashboard's sign-up mode still reads" +
        '\n"Public" because Clerk exposes no Backend API field for it (checked' +
        "\n2026-08-11). The allowlist is what restricts sign-up here. Confirm under" +
        "\nRestrictions in the Dashboard, and verify by attempting a sign-up with an" +
        "\nunlisted address before you call this closed.",
    );
  } else {
    console.error(
      `\n${failures} step(s) FAILED — the gate is NOT in the state you asked for. ` +
        "Do not treat sign-up as locked down until these are green.",
    );
  }
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
