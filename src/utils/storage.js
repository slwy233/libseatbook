import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  TOKEN: '@seat_token',
  USER_INFO: '@seat_user_info',
  SYSTEM_INFO: '@seat_system_info',
  USERNAME: '@seat_username',
  PASSWORD: '@seat_password',
  SCHEDULED_BOOKINGS: '@seat_scheduled',
};

export async function saveToken(token) {
  await AsyncStorage.setItem(KEYS.TOKEN, token);
}

export async function getToken() {
  return await AsyncStorage.getItem(KEYS.TOKEN);
}

export async function removeToken() {
  await AsyncStorage.removeItem(KEYS.TOKEN);
}

export async function saveUserInfo(info) {
  await AsyncStorage.setItem(KEYS.USER_INFO, JSON.stringify(info));
}

export async function getUserInfo() {
  const raw = await AsyncStorage.getItem(KEYS.USER_INFO);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSystemInfo(info) {
  await AsyncStorage.setItem(KEYS.SYSTEM_INFO, JSON.stringify(info));
}

export async function getSystemInfo() {
  const raw = await AsyncStorage.getItem(KEYS.SYSTEM_INFO);
  return raw ? JSON.parse(raw) : null;
}

export async function saveCredentials(username, password) {
  await AsyncStorage.setItem(KEYS.USERNAME, username);
  await AsyncStorage.setItem(KEYS.PASSWORD, password);
}

export async function getCredentials() {
  const username = await AsyncStorage.getItem(KEYS.USERNAME);
  const password = await AsyncStorage.getItem(KEYS.PASSWORD);
  return { username, password };
}

export async function saveScheduledBookings(bookings) {
  await AsyncStorage.setItem(KEYS.SCHEDULED_BOOKINGS, JSON.stringify(bookings));
}

export async function getScheduledBookings() {
  const raw = await AsyncStorage.getItem(KEYS.SCHEDULED_BOOKINGS);
  return raw ? JSON.parse(raw) : [];
}

export async function clearAll() {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
