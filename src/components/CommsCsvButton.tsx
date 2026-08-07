"use client";

/**
 * "Download CSV" for the hourly digest — builds the spreadsheet client-side
 * from the rows the server already rendered, so what you download is exactly
 * what you see. RFC-4180-style escaping: quote when a cell contains a comma,
 * quote, or newline; double embedded quotes.
 */

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function CommsCsvButton({
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
    const blob = new Blob([lines.join("\r\n")], {
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
    <button
      type="button"
      onClick={download}
      className="btn-ghost gap-1.5 text-xs"
    >
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
      Download CSV
    </button>
  );
}
