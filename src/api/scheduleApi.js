/**
 * 定时预约 API (阿里云服务器)
 */
import { encrypt } from '../utils/crypto';
import { getCredentials } from '../utils/storage';

const BASE = 'http://39.106.98.187:8911';

async function fetchJSON(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${BASE}${path}`, opts);
  return resp.json();
}

/**
 * 创建定时任务
 */
export async function createSchedule({ dateFrom, dateTo, buildingName, roomName, roomId, startMinute, endMinute, startTime, endTime, preferredSeats }) {
  const creds = await getCredentials();
  return fetchJSON('/api/schedules', 'POST', {
    dateFrom,
    dateTo,
    buildingName,
    roomName,
    roomId,
    startMinute,
    endMinute,
    startTime,
    endTime,
    preferredSeats: preferredSeats ? preferredSeats.split(',').map(s => s.trim()) : [],
    encryptedUsername: encrypt(creds.username),
    encryptedPassword: encrypt(creds.password),
  });
}

/**
 * 拉取所有任务
 */
export async function getSchedules() {
  return fetchJSON('/api/schedules');
}

/**
 * 删除任务
 */
export async function deleteSchedule(id) {
  return fetchJSON(`/api/schedules/${id}`, 'DELETE');
}

/**
 * 启用/暂停任务
 */
export async function toggleSchedule(id, enabled) {
  return fetchJSON(`/api/schedules/${id}`, 'PATCH', { enabled });
}

/**
 * 手动触发执行（即时预约今天没执行的任务）
 */
export async function executeSchedules() {
  return fetchJSON('/api/schedules/execute', 'POST');
}
