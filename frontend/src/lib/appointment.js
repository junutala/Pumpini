// src/lib/appointment.js
//
// The date arithmetic behind the appointment picker, kept out of the component
// so it can be tested. A picker that books the wrong DAY fails silently — the
// screen shows a confident date, the owner drives out, and nobody is there. That
// is worth a test file more than most things are.
//
// Everything here works in the DEVICE's local time, because that is what the
// person tapping means: "4 PM" is 4 PM where they are standing. The conversion
// to a real instant happens once, at the point of sending.

/** `YYYY-MM-DDTHH:mm` in LOCAL time — the shape <input type="datetime-local"> wants.
 *  NOT toISOString(), which would shift by the UTC offset and book a 4 PM
 *  meeting for 10:30 AM. */
export const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays    = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Days from `from` to the COMING Monday. On a Monday this is 7, not 0 — "see
 *  you Monday", said on a Monday, never means four minutes ago. */
export const daysToMonday = (from = new Date()) => ((8 - from.getDay()) % 7) || 7;

/** Whole days between two dates, ignoring the clock. Used to light up the chip
 *  matching whatever is currently selected. */
export const dayOffset = (target, from = new Date()) =>
  Math.round((startOfDay(target) - startOfDay(from)) / 86_400_000);

/** Tapping a DAY chip. Keeps an hour already chosen; otherwise opens at 10:00. */
export const applyDay = (offset, current, now = new Date()) => {
  const d = addDays(startOfDay(now), offset);
  const valid = current instanceof Date && !Number.isNaN(current.getTime());
  d.setHours(valid ? current.getHours() : 10, valid ? current.getMinutes() : 0, 0, 0);
  return toLocalInput(d);
};

/** Tapping an HOUR chip. With no day chosen yet it assumes today — unless that
 *  hour has already gone by, in which case the person plainly means tomorrow.
 *  Booking an appointment in the past is never what anyone meant. */
export const applyHour = (hour, current, now = new Date()) => {
  const valid = current instanceof Date && !Number.isNaN(current.getTime());
  let base;
  if (valid) {
    base = new Date(current);
  } else {
    const todayAt = startOfDay(now);
    todayAt.setHours(hour, 0, 0, 0);
    base = todayAt > now ? startOfDay(now) : addDays(startOfDay(now), 1);
  }
  base.setHours(hour, 0, 0, 0);
  return toLocalInput(base);
};

// ── Refusing the past ────────────────────────────────────────────────────────
// An appointment already gone is never what anyone meant, and it would sit in
// the diary looking real. The picker greys these out rather than accepting them.

/** True when this hour, on the day ALREADY chosen, has gone by. Returns false
 *  when no day is chosen yet — there `applyHour` rolls to tomorrow, which is
 *  the useful behaviour, not something to disable. */
export const isHourPast = (hour, current, now = new Date()) => {
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) return false;
  const d = new Date(current);
  d.setHours(hour, 0, 0, 0);
  return d <= now;
};

/** True when every offered hour has already gone today — which is what makes
 *  the "Today" chip pointless after the last one. */
export const isDayPast = (offset, hours, now = new Date()) => {
  if (offset > 0) return false;
  if (offset < 0) return true;
  return hours.every((h) => {
    const d = startOfDay(now);
    d.setHours(h, 0, 0, 0);
    return d <= now;
  });
};
