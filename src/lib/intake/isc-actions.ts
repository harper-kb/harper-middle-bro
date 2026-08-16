"use server";

import { revalidatePath } from "next/cache";
import { ingestIscScheduleFromPaste } from "../db";
import { getSessionOperator } from "../session/session";

/**
 * ISC portal intake action — one-time extraction of a pasted dec/schedule
 * into the policy's schedule of record. The server re-parses the text; the
 * client preview never persists anything on its own.
 */
export async function attachIscScheduleAction(formData: FormData) {
  await getSessionOperator();

  const accountId = String(formData.get("accountId") ?? "");
  const policyId = String(formData.get("policyId") ?? "");
  const text = String(formData.get("text") ?? "");
  if (!accountId || !policyId) throw new Error("Missing account or policy.");
  if (!text.trim()) throw new Error("Paste the portal document text first.");

  ingestIscScheduleFromPaste({ policyId, text });
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
}
