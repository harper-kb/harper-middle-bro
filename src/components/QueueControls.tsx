"use client";

import { useRouter } from "next/navigation";
import { queueHref, type QueueQuery } from "@/lib/queue";

/** Client widgets for the queue board: CSV export + owner filter dropdown. */

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ExportCsvButton({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  function download() {
    const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" onClick={download} className="btn-ghost gap-1.5 text-xs">
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path
          d="M8 2v8m0 0L5 7m3 3l3-3M3 12v1.5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5V12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Export CSV
    </button>
  );
}

export function OwnerFilter({
  operators,
  query,
  signedIn,
}: {
  operators: { id: string; name: string }[];
  query: QueueQuery;
  signedIn: boolean;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
      <span className="font-semibold uppercase tracking-[0.1em] text-[10px]">
        Owner
      </span>
      <select
        value={query.owner ?? ""}
        onChange={(e) =>
          router.push(
            queueHref({ ...query, owner: e.target.value || undefined }),
          )
        }
        className="field w-auto max-w-[13rem] px-3 py-1.5 text-xs"
      >
        <option value="">All Owners</option>
        {signedIn && <option value="me">Mine</option>}
        <option value="unclaimed">Unclaimed</option>
        <option value="claimed">Claimed By Anyone</option>
        {operators.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
