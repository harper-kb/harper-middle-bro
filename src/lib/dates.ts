/** Local-calendar helpers for “requests today” filtering. */

export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoToLocalDateKey(iso: string): string {
  return localDateKey(new Date(iso));
}

export function isCreatedToday(iso: string): boolean {
  return isoToLocalDateKey(iso) === localDateKey();
}

export function startOfLocalDayIso(dateKey?: string): string {
  const key = dateKey ?? localDateKey();
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function endOfLocalDayIso(dateKey?: string): string {
  const key = dateKey ?? localDateKey();
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}
