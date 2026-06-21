/**
 * 时间转换工具
 * 系统使用分钟数表示时间: 480 = 08:00, 780 = 13:00, 1310 = 21:50
 */

/**
 * Date 对象转分钟数
 */
export function dateToMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * 分钟数转 HH:MM 字符串
 */
export function minutesToTimeStr(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * HH:MM 字符串转分钟数
 */
export function timeStrToMinutes(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 获取当前分钟数
 */
export function nowMinutes() {
  return dateToMinutes(new Date());
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 获取明天的日期字符串
 */
export function tomorrowDateStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

/**
 * 获取今天的日期字符串
 */
export function todayDateStr() {
  return formatDate(new Date());
}

/**
 * 生成可预约日期列表 (今天 + 明天)
 */
export function getAvailableDates() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return [
    { label: '今天', value: formatDate(today) },
    { label: '明天', value: formatDate(tomorrow) },
  ];
}

/**
 * 比较两个时间字符串
 */
export function compareTime(a, b) {
  return timeStrToMinutes(a) - timeStrToMinutes(b);
}
