#!/usr/bin/env node
/**
 * Pack the real-book overlay into environment variables a deployed instance
 * can read.
 *
 * Run: node scripts/pack-harper-book.mjs
 *
 * Reads data/supabase-book.local.json (gitignored) and writes
 * data/harper-book-env.txt: one or more NAME=VALUE lines to paste into the
 * Railway service's variables.
 *
 * Why not commit the book: it is real customer data, and /data/ is
 * gitignored for exactly that reason. Why not fetch it at boot: the loader
 * is synchronous and runs inside the first database open, so a network call
 * there would have to restructure the boot path. Gzipped base64 in an env
 * var needs no new infrastructure and no secrets in git.
 *
 * Split into parts because a whole book is larger than some platforms allow
 * in a single value; the loader concatenates HARPER_BOOK_B64_1..n in order.
 */

import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const BOOK = path.join(process.cwd(), "data", "supabase-book.local.json");
const OUT = path.join(process.cwd(), "data", "harper-book-env.txt");
/** Comfortably under the common 32KB-per-variable ceiling. */
const CHUNK = 24_000;

if (!fs.existsSync(BOOK)) {
  console.error(
    `No book at ${BOOK}.\nRun scripts/import-harper-book.ts first.`,
  );
  process.exit(1);
}

const json = fs.readFileSync(BOOK, "utf-8");
const book = JSON.parse(json);
const b64 = gzipSync(Buffer.from(json, "utf-8"), { level: 9 }).toString("base64");

const chunks = [];
for (let i = 0; i < b64.length; i += CHUNK) chunks.push(b64.slice(i, i + CHUNK));

const lines =
  chunks.length === 1
    ? [`HARPER_BOOK_B64=${chunks[0]}`]
    : chunks.map((c, i) => `HARPER_BOOK_B64_${i + 1}=${c}`);

fs.writeFileSync(OUT, lines.join("\n") + "\n");

const schedules = Object.values(book.schedules ?? {});
console.log(`accounts    ${book.accounts?.length ?? 0}`);
console.log(`policies    ${book.policies?.length ?? 0}`);
console.log(
  `schedules   ${schedules.filter((s) => (s.limits ?? []).length > 0).length} with limits`,
);
console.log(`\nraw ${json.length} bytes → gzip+base64 ${b64.length} bytes`);
console.log(`${chunks.length} variable${chunks.length === 1 ? "" : "s"} written to ${OUT}`);
console.log(
  `\nPaste ${chunks.length === 1 ? "it" : "them, in order,"} into the Railway service variables, then redeploy.`,
);
console.log("The file itself is gitignored — it is the real book.");
