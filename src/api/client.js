import { Platform } from 'react-native';
import { encrypt, makeHmacHeaders } from '../utils/crypto';
import { getToken, saveToken, getSystemInfo, saveSystemInfo } from '../utils/storage';
import { handleTokenExpired } from '../utils/authManager';

const BASE_URL = Platform.OS === 'web'
  ? 'http://localhost:8010/jsq'
  : 'https://libseat.tjcu.edu.cn/jsq';

let cachedSystemInfo = null;

async function ensureSystemInfo() {
  if (cachedSystemInfo) {
    return cachedSystemInfo;
  }

  const stored = await getSystemInfo();
  if (stored) {
    cachedSystemInfo = stored;
    return stored;
  }

  const info = await fetchSysInfo();
  await saveSystemInfo(info);
  cachedSystemInfo = info;
  return info;
}

async function fetchSysInfo() {
  const response = await fetch(`${BASE_URL}/static/public/cg/getSysSet/PC`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  const json = await response.json();
  if (json.status && json.data) {
    return json.data;
  }

  throw new Error(json.message || '获取系统配置失败');
}

function isTokenExpiredResponse(json, response) {
  const code = String(json?.code ?? '').trim();
  const message = String(json?.message ?? json?.msg ?? '').trim();

  if (code === '20003') {
    return true;
  }

  if (response?.status === 401) {
    return true;
  }

  return /token|登录状态|重新登录|未登录|过期/i.test(message)
    && /登录|token|过期|失效/i.test(message);
}

async function post(path, data = {}, needAuth = true, allowRetryAfterRelogin = true) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    logintype: 'PC',
    loginType: 'PC',
  };

  if (needAuth) {
    const token = await getToken();
    if (token) {
      headers.token = token;
    }
  }

  const sysInfo = await ensureSystemInfo();
  if (sysInfo && sysInfo.hmac === 1) {
    const hmacHeaders = makeHmacHeaders('POST', data);
    headers.nonce = hmacHeaders.nonce;
    headers.date = hmacHeaders.date;
    headers.digest = hmacHeaders.digest;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });

  const json = await response.json();

  if (needAuth && allowRetryAfterRelogin && isTokenExpiredResponse(json, response)) {
    const reloginResult = await handleTokenExpired();
    if (reloginResult?.success) {
      return await post(path, data, needAuth, false);
    }
    throw new Error('TOKEN_EXPIRED');
  }

  if (isTokenExpiredResponse(json, response)) {
    throw new Error('TOKEN_EXPIRED');
  }

  if (json.status === false) {
    throw new Error(json.message || '请求失败');
  }

  return json;
}

export async function getCaptcha(username) {
  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/static/public/cg/generateCaptcha/${username}`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('logintype', 'PC');
    xhr.setRequestHeader('loginType', 'PC');
    xhr.timeout = 10000;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) {
        return;
      }

      if (xhr.status !== 200) {
        reject(new Error(`请求失败 HTTP ${xhr.status}`));
        return;
      }

      try {
        const json = JSON.parse(xhr.responseText);
        if (json.status && json.data) {
          resolve({
            captchaId: json.data.captchaId,
            captchaImage: json.data.captchaText,
          });
          return;
        }

        reject(new Error(json.message || '获取验证码失败'));
      } catch (error) {
        reject(new Error('解析验证码响应失败'));
      }
    };
    xhr.onerror = () => reject(new Error('网络连接失败'));
    xhr.ontimeout = () => reject(new Error('请求超时'));
    xhr.send('{}');
  });
}

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

export async function getUserInfo() {
  return await post('/static/frontApi/user/getUserInfo', {});
}

export async function getCurrentMake() {
  return await post('/static/frontApi/user/currentUseMake', {});
}

export async function getLastMake() {
  return await post('/static/frontApi/user/lastMake', {});
}

export async function getBuildingFloorDate() {
  return await post('/static/frontApi/res/buildingFloorDate', {});
}

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

export async function getSeatLayout(roomId, page = 1) {
  return await post(`/static/frontApi/res/querySeatLayout/${roomId}/${page}`, {});
}

export async function getStartTimes(seatId, date) {
  return await post(`/static/frontApi/res/getStartTimes/${seatId}/${date}`, {});
}

export async function getEndTimes(seatId, date, startMinute) {
  return await post(`/static/frontApi/res/getEndTimes/${seatId}/${date}/${startMinute}`, {});
}

export async function getTimeLine(seatId, date) {
  return await post(`/static/frontApi/res/getTimeLine/${seatId}/${date}`, {});
}

export async function bookSeat(seatId, date, startMinute, endMinute, capToken = 'capToken') {
  return await post(
    `/static/frontApi/make/freeBook/${seatId}/${date}/${startMinute}/${endMinute}?capToken=${capToken}`,
    {},
    true
  );
}

export async function cancelBooking(bookingId) {
  return await post(`/static/frontApi/make/cancel/${bookingId}`, {}, true);
}

export async function initSystemConfig() {
  const info = await fetchSysInfo();
  await saveSystemInfo(info);
  cachedSystemInfo = info;
  return info;
}
