/**
 * Date helpers that avoid `Intl`, so server and client output are identical
 * (no hydration mismatches from differing ICU data). All demo timestamps are
 * ISO strings written in fictional South African local time (+02:00).
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "2026-10-28T09:12:00+02:00" -> "28 Oct 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  const month = MONTHS_SHORT[Number(m) - 1] ?? "";
  return `${Number(d)} ${month} ${y}`;
}

/** "2026-10-28T09:12:00+02:00" -> "09:12" */
export function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

/** "2026-10-28T09:12:00+02:00" -> "28 Oct 2026, 09:12" */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** "2026-10" -> "October 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS_LONG[Number(m) - 1] ?? ""} ${y}`;
}

/** Calendar-day key used to group timeline entries. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function initials(first: string, last: string): string {
  return `${first.trim().charAt(0)}${last.trim().charAt(0)}`.toUpperCase();
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
