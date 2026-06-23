import { Platform } from 'react-native';
import { encrypt, makeHmacHeaders } from '../utils/crypto';
import { getToken, saveToken, getSystemInfo, saveSystemInfo } from '../utils/storage';
import { handleTokenExpired } from '../utils/authManager';

// 移动端直连；Web端通过本地代理绕过浏览器CORS
// Web: 需要先在终端运行 npx local-cors-proxy --proxyUrl https://libseat.tjcu.edu.cn --port 8010
const BASE_URL = Platform.OS === 'web'
  ? 'http://localhost:8010/jsq'
  : 'https://libseat.tjcu.edu.cn/jsq';

let cachedSystemInfo = null;

async function ensureSystemInfo() {
  if (cachedSystemInfo) return cachedSystemInfo;
  const stored = await getSystemInfo();
  if (stored) {
    cachedSystemInfo = stored;
    return stored;
  }
  // 首次获取系统配置 (无需登录)
  const info = await fetchSysInfo();
  await saveSystemInfo(info);
  cachedSystemInfo = info;
  return info;
}

async function fetchSysInfo() {
  const resp = await fetch(`${BASE_URL}/static/public/cg/getSysSet/PC`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const json = await resp.json();
  if (json.status && json.data) {
    return json.data;
  }
  throw new Error('获取系统配置失败');
}

/**
 * 通用 POST 请求
 */
async function post(path, data = {}, needAuth = true) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'logintype': 'PC',
  };

  if (needAuth) {
    const token = await getToken();
    if (token) headers['token'] = token;
  }

  // HMAC 签名 — 认证API强制要求
  const sysInfo = await ensureSystemInfo();
  if (sysInfo && sysInfo.hmac === 1) {
    Object.assign(headers, makeHmacHeaders('POST', sysInfo));
  }

  const body = JSON.stringify(data);

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  const json = await resp.json();

  // 处理 token 过期 (code 20003) — 自动重登并重试一次
  if (json.code === '20003' && needAuth) {
    const { handleTokenExpired, forceLogout } = require('../utils/authManager');
    const reloginResult = await handleTokenExpired();
    if (reloginResult.success) {
      // 重登成功 — 更新token+签名，重试请求
      const newToken = await getToken();
      if (newToken) headers['token'] = newToken;
      const sysInfo2 = await ensureSystemInfo();
      if (sysInfo2 && sysInfo2.hmac === 1) {
        ['x-request-id', 'x-request-date', 'x-hmac-request-key'].forEach(k => delete headers[k]);
        Object.assign(headers, makeHmacHeaders('POST', sysInfo2));
      }
      const retryResp = await fetch(url, { method: 'POST', headers, body });
      const retryJson = await retryResp.json();
      if (retryJson.code === '20003' || retryJson.status === false) {
        forceLogout(true);
        throw new Error('TOKEN_EXPIRED');
      }
      return retryJson;
    }
    // 重登失败也已经由handleTokenExpired内部调用_onExpired处理了
    throw new Error('TOKEN_EXPIRED');
  }

  if (json.code === '20003') {
    throw new Error('TOKEN_EXPIRED');
  }
  if (json.status === false) {
    throw new Error(json.message || '请求失败');
  }

  return json;
}

/**
 * 获取验证码 — 使用 XMLHttpRequest, 避开 RN fetch 的已知问题
 */
export async function getCaptcha(username) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${BASE_URL}/static/public/cg/generateCaptcha/${username}`;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('loginType', 'PC');
    xhr.timeout = 10000;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          const json = JSON.parse(xhr.responseText);
          if (json.status && json.data) {
            resolve({
              captchaId: json.data.captchaId,
              captchaImage: json.data.captchaText,
            });
          } else {
            reject(new Error(json.message || '获取验证码失败'));
          }
        } catch (e) {
          reject(new Error('解析验证码响应失败'));
        }
      } else {
        reject(new Error(`请求失败 HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('网络连接失败'));
    xhr.ontimeout = () => reject(new Error('请求超时'));
    xhr.send('{}');
  });
}

/**
 * 登录
 */
export async function login(username, password, captchaId, captchaText) {
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

  if (json.status && json.data) {
    await saveToken(json.data.token);
    return {
      token: json.data.token,
      userInfo: json.data.userInfoRes,
    };
  }
  throw new Error(json.message || '登录失败');
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
  const info = await fetchSysInfo();
  await saveSystemInfo(info);
  cachedSystemInfo = info;
  return info;
}
