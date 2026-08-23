// src/lib/appointment.js
//
// The date arithmetic behind the appointment picker, kept out of the component
// so it can be tested. A picker that books the wrong DAY fails silently — the
// screen shows a confident date, the owner drives out, and nobody is there.
//
// ── Why there are no relative words here ─────────────────────────────────────
// The first version offered "Today / Tomorrow / Day after / Monday". On a Sunday
// that renders TWO CHIPS FOR THE SAME DAY — tomorrow IS Monday — and the owner
// rightly called it confusing (23-Aug-2026). Relative words also make the reader
// do arithmetic they should never have to do. So the picker names actual days:
// "Mon 25", "Tue 26". Only the current date gets a word, because "Today" is the
// one label nobody can misread.
//
// Everything works in the DEVICE's local time, because that is what the person
// tapping means: 4 PM is 4 PM where they are standing. The conversion to a real
// instant happens once, at the point of sending.

/** `YYYY-MM-DDTHH:mm` in LOCAL time — the shape <input type="datetime-local"> wants.
 *  NOT toISOString(), which would shift by the UTC offset and book a 4 PM IST
 *  meeting for 10:30 AM. */
export const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** `HH:mm` in local time — what <input type="time"> wants. */
export const toTimeInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays    = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Whole days between two dates, ignoring the clock. Lights up the right chip. */
export const dayOffset = (target, from = new Date()) =>
  Math.round((startOfDay(target) - startOfDay(from)) / 86_400_000);

/**
 * The next `count` days, starting today. Each carries what the chip must show:
 * a weekday, a date, and — only for the current day — the word "Today".
 * No relative words beyond that, so no two chips can ever mean the same day.
 */
export const dayChoices = (count = 14, now = new Date()) =>
  Array.from({ length: count }, (_, i) => {
    const d = addDays(startOfDay(now), i);
    return {
      offset:  i,
      date:    d,
      weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }),   // Mon
      day:     d.getDate(),                                           // 25
      month:   d.toLocaleDateString('en-IN', { month: 'short' }),     // Aug
      isToday: i === 0,
    };
  });

/** Combine a chosen day with a chosen `HH:mm`. Either may be missing: a day with
 *  no time yet is left at midnight and simply not sendable until a time is set. */
export const combine = (day, time) => {
  if (!day) return '';
  const d = new Date(day);
  if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(':').map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) d.setHours(h, m, 0, 0);
    else d.setHours(0, 0, 0, 0);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return toLocalInput(d);
};

/** The earliest time selectable on a given day: unrestricted on a future day,
 *  and "now" on the current one, so the past cannot be booked. Returns null when
 *  there is nothing to restrict. */
export const minTimeFor = (day, now = new Date()) => {
  if (!day) return null;
  return dayOffset(day, now) === 0 ? toTimeInput(now) : null;
};

/** True when this day+time pair is already behind us. The picker refuses to save
 *  on it — an appointment in the past is never what anyone meant. */
export const isPast = (value, now = new Date()) => {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d <= now;
};

/**
 * The ONE rule for "is this actually an appointment", and the only place the
 * picker's value becomes something sendable.
 *
 * Returns an ISO instant, or null when it is not bookable:
 *   - nothing chosen, or an unparseable value
 *   - a DAY chosen but no time yet (held at midnight — nobody books a petrol
 *     bunk at 00:00, so midnight is the honest sentinel for "time not set")
 *   - a time already gone
 *
 * Both screens call this rather than doing `new Date(v).toISOString()`
 * themselves, so the rule cannot drift between them.
 */
export const toInstant = (value, now = new Date()) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;   // day picked, no time
  if (d <= now) return null;                                     // already gone
  return d.toISOString();
};
