// netlify/functions/lib/date-utils.mjs
// 2026-11-22: shared pure date helper, same shared-lib pattern
// cabin-class.mjs and city-coords.mjs already use. watch.mjs (validation)
// and watch-check.mjs (leg building) both need the same "outbound date plus
// N stopover nights" arithmetic, and it must agree with index.html's own
// addDaysIso so a watched trip prices the same itinerary that was searched.
// Noon-UTC anchor avoids a timezone off-by-one on bare dates.
export function addDaysIso(dateStr, n) {
  const dt = new Date(dateStr + "T12:00:00Z");
  if (isNaN(dt)) return dateStr;
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
