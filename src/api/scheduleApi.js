/**
 * 定时预约 API (阿里云服务器)
 */
import { encrypt } from '../utils/crypto';
import { getCredentials } from '../utils/storage';
import { requestJSON, assertBusinessSuccess, apiError } from './http';

const BASE = 'http://39.106.98.187:8911';

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function fetchJSON(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const response = await requestJSON(`${BASE}${path}`, opts);
  assertBusinessSuccess(response, '定时预约请求失败');
  if (response.status !== true) throw apiError('定时预约服务响应无效', 'INVALID_RESPONSE', { responseBody: response });
  return response;
}

/**
 * 创建定时任务
 */
export async function createSchedule({ dateFrom, dateTo, buildingName, roomName, roomId, startMinute, endMinute, startTime, endTime, preferredSeats }) {
  const creds = await getCredentials();
  if (!creds?.username || !creds?.password) throw apiError('请先登录并保存账号后创建定时预约', 'MISSING_CREDENTIALS');
  if (!validDate(dateFrom) || !validDate(dateTo) || dateTo < dateFrom) {
    throw apiError('请选择有效的预约日期范围', 'INVALID_INPUT');
  }
  if (!roomId || !Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute < 0 || endMinute > 1440 || endMinute <= startMinute) {
    throw apiError('请选择房间和有效的开始、结束时间', 'INVALID_INPUT');
  }
  const seatList = Array.isArray(preferredSeats) ? preferredSeats : String(preferredSeats || '').split(',');
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
    preferredSeats: [...new Set(seatList.map(s => String(s).trim()).filter(Boolean))],
    encryptedUsername: encrypt(creds.username),
    encryptedPassword: encrypt(creds.password),
  });
}

/**
 * 拉取所有任务
 */
export async function getSchedules() {
  const response = await fetchJSON('/api/schedules');
  if (!Array.isArray(response.data)) throw apiError('定时任务列表格式无效', 'INVALID_RESPONSE');
  return response;
}

/**
 * 删除任务
 */
export async function deleteSchedule(id) {
  if (!id) throw apiError('缺少任务编号', 'INVALID_INPUT');
  return fetchJSON(`/api/schedules/${encodeURIComponent(id)}`, 'DELETE');
}

/**
 * 启用/暂停任务
 */
export async function toggleSchedule(id, enabled) {
  if (!id || typeof enabled !== 'boolean') throw apiError('任务状态无效', 'INVALID_INPUT');
  return fetchJSON(`/api/schedules/${encodeURIComponent(id)}`, 'PATCH', { enabled });
}

/**
 * 手动触发执行（即时预约今天没执行的任务）
 */
export async function executeSchedules() {
  return fetchJSON('/api/schedules/execute', 'POST');
}
