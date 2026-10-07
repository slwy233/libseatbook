import { todayDateStr } from './time';

export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function isValidTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateSchedule({ dateFrom, dateTo, startTime, endTime }, today = todayDateStr()) {
  if (!isValidDate(dateFrom) || !isValidDate(dateTo)) return '请输入有效日期，格式为 YYYY-MM-DD';
  if (dateFrom < today) return '起始日期不能早于今天';
  if (dateTo < dateFrom) return '结束日期不能早于起始日期';
  if (!isValidTime(startTime) || !isValidTime(endTime)) return '请输入有效时间，格式为 HH:MM（00:00 至 23:59）';
  if (endTime <= startTime) return '结束时间必须晚于开始时间';
  return null;
}

export function parsePreferredSeats(value = '') {
  const seats = Array.isArray(value) ? value : String(value).split(/[,，]/);
  return [...new Set(seats.map(seat => String(seat).trim()).filter(Boolean))];
}
