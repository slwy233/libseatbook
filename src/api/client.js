import { Platform } from 'react-native';
import { encrypt, makeHmacHeaders } from '../utils/crypto';
import { getToken, saveToken, getSystemInfo, saveSystemInfo, getSessionVersion, isSessionCurrent } from '../utils/storage';
import { handleTokenExpired, forceLogout } from '../utils/authManager';
import { requestJSON, apiError, assertBusinessSuccess } from './http';

// Web requires the documented local CORS proxy; mobile connects directly.
const BASE_URL = Platform.OS === 'web'
  ? 'http://localhost:8010/jsq'
  : 'https://libseat.tjcu.edu.cn/jsq';

let cachedSystemInfo = null;
let systemInfoFlight = null;

async function ensureSystemInfo(force = false) {
  if (!force && cachedSystemInfo) return cachedSystemInfo;
  if (systemInfoFlight) return systemInfoFlight;
  systemInfoFlight = (async () => {
    if (!force) {
      const stored = await getSystemInfo();
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        cachedSystemInfo = stored;
        return stored;
      }
    }
    const info = await fetchSysInfo();
    await saveSystemInfo(info);
    cachedSystemInfo = info;
    return info;
  })().finally(() => { systemInfoFlight = null; });
  return systemInfoFlight;
}

async function fetchSysInfo() {
  const json = await requestJSON(`${BASE_URL}/static/public/cg/getSysSet/PC`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assertBusinessSuccess(json, '获取系统配置失败');
  if (json.status && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) return json.data;
  throw apiError('获取系统配置失败', 'INVALID_RESPONSE');
}

function sessionChanged() { return apiError('登录状态已改变，请重新操作', 'SESSION_CHANGED'); }
function tokenExpired() { return apiError('登录已过期，请重新登录', 'TOKEN_EXPIRED'); }

async function post(path, data = {}, needAuth = true) {
  const version = getSessionVersion();
  const token = needAuth ? await getToken() : null;
  if (needAuth && !isSessionCurrent(version)) throw sessionChanged();
  if (needAuth && !token) {
    await forceLogout(true, { expectedVersion: version });
    throw tokenExpired();
  }
  const sysInfo = await ensureSystemInfo();
  const body = JSON.stringify(data);
  const send = async (requestToken) => {
    if (needAuth && !isSessionCurrent(version)) throw sessionChanged();
    const headers = { 'Content-Type': 'application/json', logintype: 'PC' };
    if (requestToken) headers.token = requestToken;
    if (sysInfo?.hmac === 1) Object.assign(headers, makeHmacHeaders('POST', sysInfo));
    const json = await requestJSON(`${BASE_URL}${path}`, { method: 'POST', headers, body });
    if (needAuth && !isSessionCurrent(version)) throw sessionChanged();
    return json;
  };
  let json = await send(token);
  if (String(json.code) === '20003' && needAuth) {
    const recovered = await handleTokenExpired(token, version);
    if (recovered.cancelled) throw sessionChanged();
    if (!recovered.success) throw tokenExpired();
    if (!isSessionCurrent(version)) throw sessionChanged();
    const freshToken = await getToken();
    json = await send(freshToken);
    if (String(json.code) === '20003') {
      await forceLogout(true, { expectedVersion: version, expectedToken: freshToken });
      throw tokenExpired();
    }
  }
  if (String(json.code) === '20003') throw tokenExpired();
  return assertBusinessSuccess(json);
}
/**
 * 获取验证码 — 使用 XMLHttpRequest, 避开 RN fetch 的已知问题
 */
export async function getCaptcha(username) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${BASE_URL}/static/public/cg/generateCaptcha/${encodeURIComponent(username)}`;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('loginType', 'PC');
    xhr.timeout = 10000;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          const json = JSON.parse(xhr.responseText);
          if (json.status && json.data?.captchaId && typeof json.data.captchaText === 'string' && json.data.captchaText) {
            resolve({
              captchaId: json.data.captchaId,
              captchaImage: json.data.captchaText,
            });
          } else {
            reject(apiError(json.message || '获取验证码失败', json.code || 'BUSINESS_ERROR', { responseBody: json }));
          }
        } catch (e) {
          reject(apiError('解析验证码响应失败', 'INVALID_JSON'));
        }
      } else {
        reject(apiError(`请求失败 HTTP ${xhr.status}`, xhr.status ? 'HTTP_ERROR' : 'NETWORK_ERROR', { httpStatus: xhr.status }));
      }
    };
    xhr.onerror = () => reject(apiError('网络连接失败', 'NETWORK_ERROR'));
    xhr.ontimeout = () => reject(apiError('请求超时', 'TIMEOUT'));
    xhr.send('{}');
  });
}

/**
 * 登录
 */
export async function login(username, password, captchaId, captchaText, { persistToken = true } = {}) {
  const version = getSessionVersion();
  const encryptedUsername = encrypt(username);
  const encryptedPassword = encrypt(password);

  const json = await post('/static/public/auth/user', {
    username: encryptedUsername,
    password: encryptedPassword,
    sysCaptchaRes: {
      captchaId: captchaId || '',
      captchaText: captchaText || '-1',
    },
  }, false);

  if (json.status && typeof json.data?.token === 'string' && json.data.token.trim()) {
    if (persistToken && !await saveToken(json.data.token, { expectedVersion: version })) throw sessionChanged();
    return {
      token: json.data.token,
      userInfo: json.data.userInfoRes,
    };
  }
  throw apiError(json.message || '登录响应缺少有效 token', 'INVALID_RESPONSE', { responseBody: json });
}

/**
 * 获取用户信息
 */
export async function getUserInfo() {
  return await post('/static/frontApi/user/getUserInfo', {});
}

/**
 * 获取当前预约
 */
export async function getCurrentMake() {
  return await post('/static/frontApi/user/currentUseMake', {});
}

/**
 * 获取预约历史
 */
export async function getLastMake() {
  return await post('/static/frontApi/user/lastMake', {});
}

/**
 * 获取楼栋和楼层信息
 */
export async function getBuildingFloorDate() {
  return await post('/static/frontApi/res/buildingFloorDate', {});
}

/**
 * 获取房间列表
 * @param {string} buildingId - 楼栋ID
 * @param {string} date - 日期 YYYY-MM-DD
 * @param {object} params - 可选筛选参数
 */
export async function findRoomDuration(buildingId, date, params = {}) {
  const defaultParams = {
    beginMinute: -1,
    currentPage: 1,
    endMinute: 0,
    floorId: 0,
    minMinute: 0,
    pageSize: 50,
    power: false,
    roomType: false,
    sortField: '',
    sortType: '',
    windows: false,
  };
  return await post(
    `/static/frontApi/res/findRoomDuration/${buildingId}/${date}`,
    { ...defaultParams, ...params }
  );
}

/**
 * 获取空闲座位
 * @param {string} roomId - 房间ID
 * @param {string} date - 日期
 * @param {object} params - { beginMinute, endMinute, minMinute }
 */
export async function getFreeSeats(roomId, date, params = {}) {
  const defaultParams = {
    beginMinute: -1,
    endMinute: 0,
    minMinute: 0,
  };
  return await post(
    `/static/frontApi/res/freeSeatIdsDuration/${roomId}/${date}`,
    { ...defaultParams, ...params }
  );
}

/**
 * 获取座位布局
 */
export async function getSeatLayout(roomId, page = 1) {
  return await post(
    `/static/frontApi/res/querySeatLayout/${roomId}/${page}`,
    {}
  );
}

/**
 * 获取开始时间列表
 */
export async function getStartTimes(seatId, date) {
  return await post(
    `/static/frontApi/res/getStartTimes/${seatId}/${date}`,
    {}
  );
}

/**
 * 获取结束时间列表
 */
export async function getEndTimes(seatId, date, startMinute) {
  return await post(
    `/static/frontApi/res/getEndTimes/${seatId}/${date}/${startMinute}`,
    {}
  );
}

/**
 * 获取时间线
 */
export async function getTimeLine(seatId, date) {
  return await post(
    `/static/frontApi/res/getTimeLine/${seatId}/${date}`,
    {}
  );
}

/**
 * 预约座位
 * @param {string} seatId - 座位ID
 * @param {string} date - 日期 YYYY-MM-DD
 * @param {number} startMinute - 开始分钟数
 * @param {number} endMinute - 结束分钟数
 * @param {string} capToken - 验证码token (mackCaptcha=0时传'capToken')
 */
export async function bookSeat(seatId, date, startMinute, endMinute, capToken = 'capToken') {
  return await post(
    `/static/frontApi/make/freeBook/${seatId}/${date}/${startMinute}/${endMinute}?capToken=${capToken}`,
    {},
    true
  );
}

/**
 * 取消预约
 * @param {string} bookingId - 预约记录ID
 */
export async function cancelBooking(bookingId) {
  return await post(`/static/frontApi/make/cancel/${bookingId}`, {}, true);
}

/**
 * 初始化: 获取系统配置
 */
export async function initSystemConfig() {
  return ensureSystemInfo(true);
}

