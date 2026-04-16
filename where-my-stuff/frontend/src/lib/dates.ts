/** Parse an expected_date string (from email) into an absolute Date.
 *  receivedMs is the email's received_date — used to anchor relative day names. */
export function parseExpectedDate(expectedDate: string | null | undefined, receivedMs: number): Date | null {
  if (!expectedDate) return null;
  const s = expectedDate.trim();
  const lower = s.toLowerCase();

  const ref = new Date(receivedMs);
  ref.setHours(0, 0, 0, 0);

  if (lower === 'today') return new Date(ref);
  if (lower === 'tomorrow') {
    const d = new Date(ref); d.setDate(d.getDate() + 1); return d;
  }

  // Day name: "Monday" or "Monday, Apr 18"
  const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const firstWord = lower.split(/[\s,]/)[0];
  const dayIdx = DAY_NAMES.indexOf(firstWord);
  if (dayIdx >= 0) {
    const diff = (dayIdx - ref.getDay() + 7) % 7;
    const d = new Date(ref);
    d.setDate(d.getDate() + diff);
    // If the day string also has a month+date, try a full parse to be more accurate
    const full = `${s} ${ref.getFullYear()}`;
    const parsed = new Date(full);
    if (!isNaN(parsed.getTime()) && Math.abs(parsed.getTime() - d.getTime()) < 8 * 86400000) return parsed;
    return d;
  }

  // "18 Apr", "Apr 18", "18 Apr 2025", "Apr 18, 2025"
  // Strip ordinal suffixes first
  const clean = s.replace(/(\d+)(?:st|nd|rd|th)/i, '$1');
  const year = new Date(receivedMs).getFullYear();
  const withYear = /\d{4}/.test(clean) ? clean : `${clean} ${year}`;
  const d = new Date(withYear);
  if (!isNaN(d.getTime())) return d;

  return null;
}

export function countdownLabel(expectedDate: string | null | undefined, receivedMs: number, stage: number): {
  text: string;
  overdue: boolean;
} | null {
  if (!expectedDate || stage >= 5) return null;
  const d = parseExpectedDate(expectedDate, receivedMs);
  if (!d) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400_000);

  if (diffDays < 0) return { text: `Overdue by ${Math.abs(diffDays)}d`, overdue: true };
  if (diffDays === 0) return { text: 'Arriving today', overdue: false };
  if (diffDays === 1) return { text: 'Arriving tomorrow', overdue: false };
  return { text: `Arrives in ${diffDays} days`, overdue: false };
}
