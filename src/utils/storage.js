import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  TOKEN: '@seat_token',
  USER_INFO: '@seat_user_info',
  SYSTEM_INFO: '@seat_system_info',
  USERNAME: '@seat_username',
  PASSWORD: '@seat_password',
  SCHEDULED_BOOKINGS: '@seat_scheduled',
};

let sessionVersion = 0;
let sessionWrites = Promise.resolve();
export function getSessionVersion() { return sessionVersion; }
export function isSessionCurrent(version) { return version === sessionVersion; }

function sessionWrite(action) {
  const pending = sessionWrites.then(action, action);
  sessionWrites = pending.catch(() => {});
  return pending;
}

export async function saveToken(token, { expectedVersion, refresh = false } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('登录响应缺少有效 token');
  if (expectedVersion !== undefined && !isSessionCurrent(expectedVersion)) return false;
  const version = refresh ? sessionVersion : ++sessionVersion;
  return sessionWrite(async () => {
    if (!isSessionCurrent(version)) return false;
    await AsyncStorage.setItem(KEYS.TOKEN, token);
    return isSessionCurrent(version);
  });
}

export async function getToken() {
  await sessionWrites;
  return await AsyncStorage.getItem(KEYS.TOKEN);
}

export async function removeToken() {
  return clearSession();
}

export async function saveUserInfo(info, expectedVersion = sessionVersion) {
  return sessionWrite(async () => {
    if (!isSessionCurrent(expectedVersion)) return false;
    if (info === undefined || info === null) await AsyncStorage.removeItem(KEYS.USER_INFO);
    else await AsyncStorage.setItem(KEYS.USER_INFO, JSON.stringify(info));
    return isSessionCurrent(expectedVersion);
  });
}

function parseStored(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

export async function getUserInfo() {
  await sessionWrites;
  const raw = await AsyncStorage.getItem(KEYS.USER_INFO);
  return parseStored(raw, null);
}

export async function saveSystemInfo(info) {
  await AsyncStorage.setItem(KEYS.SYSTEM_INFO, JSON.stringify(info));
}

export async function getSystemInfo() {
  const raw = await AsyncStorage.getItem(KEYS.SYSTEM_INFO);
  return parseStored(raw, null);
}

export async function saveCredentials(username, password, expectedVersion = sessionVersion) {
  return sessionWrite(async () => {
    if (!isSessionCurrent(expectedVersion)) return false;
    await AsyncStorage.setItem(KEYS.USERNAME, username);
    await AsyncStorage.setItem(KEYS.PASSWORD, password);
    return isSessionCurrent(expectedVersion);
  });
}

export async function getCredentials() {
  await sessionWrites;
  const username = await AsyncStorage.getItem(KEYS.USERNAME);
  const password = await AsyncStorage.getItem(KEYS.PASSWORD);
  return { username, password };
}

export async function saveScheduledBookings(bookings) {
  await AsyncStorage.setItem(KEYS.SCHEDULED_BOOKINGS, JSON.stringify(bookings));
}

export async function getScheduledBookings() {
  const raw = await AsyncStorage.getItem(KEYS.SCHEDULED_BOOKINGS);
  const bookings = parseStored(raw, []);
  return Array.isArray(bookings) ? bookings : [];
}

export async function clearAll() {
  const version = ++sessionVersion;
  return sessionWrite(async () => {
    if (isSessionCurrent(version)) await AsyncStorage.multiRemove(Object.values(KEYS));
  });
}

/** Expiry preserves credentials for the manual login form and system configuration. */
export async function clearSession({ forgetCredentials = false, expectedVersion } = {}) {
  if (expectedVersion !== undefined && !isSessionCurrent(expectedVersion)) return false;
  const version = ++sessionVersion;
  const keys = [KEYS.TOKEN, KEYS.USER_INFO, KEYS.SCHEDULED_BOOKINGS];
  if (forgetCredentials) keys.push(KEYS.USERNAME, KEYS.PASSWORD);
  return sessionWrite(async () => {
    if (!isSessionCurrent(version)) return false;
    await AsyncStorage.multiRemove(keys);
    return isSessionCurrent(version);
  });
}
