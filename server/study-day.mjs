export const dayStartHour = 4;

export function studyDayStart(date = new Date()) {
  const start = new Date(date);
  if (start.getHours() < dayStartHour) start.setDate(start.getDate() - 1);
  start.setHours(dayStartHour, 0, 0, 0);
  return start;
}

export function studyDay(date = new Date()) {
  const start = studyDayStart(date);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

export function nextStudyDay(date = new Date()) {
  const next = studyDayStart(date);
  next.setDate(next.getDate() + 1);
  return next;
}

// FSRS chooses the interval; the app makes day-based reviews available at
// the beginning of that study day. Calendar arithmetic also handles DST.
export function scheduleStudyDay(card, reviewedAt) {
  if (card.state !== 2) return card;
  const due = studyDayStart(reviewedAt);
  due.setDate(due.getDate() + card.scheduled_days);
  return { ...card, due };
}
