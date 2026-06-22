import CryptoJS from 'crypto-js';

export const DEFAULT_KEY = 'server_date_time';
export const DEFAULT_IV = 'client_date_time';
const HMAC_KEY = 'fkJlSwDn467GnoE4nWHNlg==';

/**
 * AES-CBC 加密
 */
export function encrypt(text, keyStr = DEFAULT_KEY, ivStr = DEFAULT_IV) {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  const src = CryptoJS.enc.Utf8.parse(text);
  return CryptoJS.AES.encrypt(src, key, {
    iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  }).toString();
}

/**
 * 解密 (预留)
 */
export function decrypt(cipherText, keyStr = DEFAULT_KEY, ivStr = DEFAULT_IV) {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  const result = CryptoJS.AES.decrypt(cipherText, key, {
    iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  });
  return CryptoJS.enc.Utf8.stringify(result).toString();
}

/**
 * 生成 UUID v4 hex (36字符, 无横线, 与前端完全一致)
 */
function generateNonce() {
  const chars = '0123456789abcdef';
  const result = [];
  for (let i = 0; i < 36; i++) {
    result[i] = chars[Math.floor(Math.random() * 16)];
  }
  result[14] = '4';
  result[19] = chars[Math.floor(Math.random() * 4)];
  return result.join('');
}

/**
 * 生成 HMAC 签名头
 *
 * 破解要点：
 * 1. hmacKey是AES加密的，需要先用makePrefix/makeSuffix解密
 * 2. 签名格式：seat::{requestId}::{timestamp}::{METHOD}（不包含body！）
 * 3. HMAC-SHA256用解密后的真实key
 */
export function makeHmacHeaders(method, sysInfo) {
  const requestId = generateNonce();
  const requestDate = Date.now().toString();

  // 1. AES解密hmacKey，得到真实的HMAC密钥
  const iv = CryptoJS.enc.Utf8.parse(sysInfo.makeSuffix || DEFAULT_IV);
  const key = CryptoJS.enc.Utf8.parse(sysInfo.makePrefix || DEFAULT_KEY);
  const decrypted = CryptoJS.AES.decrypt(sysInfo.hmacKey, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  const realHmacKey = decrypted.toString(CryptoJS.enc.Utf8);

  // 2. 构造签名字符串（学校前端格式）
  const signStr = `seat::${requestId}::${requestDate}::${method.toUpperCase()}`;

  // 3. 用真实key计算HMAC
  const hmac = CryptoJS.HmacSHA256(signStr, realHmacKey).toString();

  return {
    'x-request-id': requestId,
    'x-request-date': requestDate,
    'x-hmac-request-key': hmac,
  };
}
