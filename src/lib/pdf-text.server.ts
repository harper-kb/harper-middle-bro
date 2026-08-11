import "server-only";

/**
 * PDF → reading-order text. Server-only: pdfjs is heavy and has no business
 * in a client bundle, and the bytes never need to leave the server anyway.
 *
 * A PDF's text layer arrives as positioned fragments, not lines — the order
 * in the content stream is whatever order the generator emitted glyphs in.
 * Grouping by baseline and sorting by x recovers the reading order the
 * downstream parsers expect. Same algorithm as scripts/import-real-isc.ts.
 *
 * This extracts an EXISTING text layer. It is not OCR: a scanned or
 * photographed certificate carries no text layer and yields nothing, which
 * the caller must report as unreadable rather than treat as an empty cert.
 */

/** Baseline tolerance in PDF units — two fragments this close are one line. */
const SAME_LINE_EPSILON = 2.5;

export async function extractPdfLines(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs rejects a Node Buffer outright, even though Buffer IS a Uint8Array.
  // Callers reading a file or a request body hold Buffers, so re-view the
  // same memory as a plain Uint8Array here rather than at every call site.
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const task = getDocument({ data, verbosity: 0 });
  const doc = await task.promise;
  const lines: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const items = (tc.items as { str?: string; transform?: number[] }[])
        .filter((i) => typeof i.str === "string" && i.str.trim() && i.transform)
        .map((i) => ({ str: i.str!.trim(), x: i.transform![4], y: i.transform![5] }));
      const rows: { y: number; cells: { str: string; x: number }[] }[] = [];
      for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const row = rows.find((r) => Math.abs(r.y - it.y) < SAME_LINE_EPSILON);
        if (row) row.cells.push(it);
        else rows.push({ y: it.y, cells: [it] });
      }
      for (const r of rows) {
        lines.push(
          r.cells
            .sort((a, b) => a.x - b.x)
            .map((c) => c.str)
            .join(" "),
        );
      }
      lines.push(""); // page boundary
    }
  } finally {
    await task.destroy();
  }
  return lines;
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  return (await extractPdfLines(bytes)).join("\n");
}
