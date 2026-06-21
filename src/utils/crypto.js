import CryptoJS from 'react-native-crypto-js';

// 从 getSysSet/PC 接口获取
const DEFAULT_KEY = 'server_date_time';
const DEFAULT_IV = 'client_date_time';
const HMAC_KEY = 'fkJlSwDn467GnoE4nWHNlg==';

/**
 * AES-CBC 加密，与前端 E() 函数一致
 */
export function encrypt(text, keyStr = DEFAULT_KEY, ivStr = DEFAULT_IV) {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  const src = CryptoJS.enc.Utf8.parse(text);
  const encrypted = CryptoJS.AES.encrypt(src, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.toString();
}

/**
 * AES-CBC 解密，与前端 Q() 函数一致
 */
export function decrypt(cipherText, keyStr = DEFAULT_KEY, ivStr = DEFAULT_IV) {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  const decrypted = CryptoJS.AES.decrypt(cipherText, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return CryptoJS.enc.Utf8.stringify(decrypted).toString();
}

/**
 * 生成 HMAC 签名 (用于拦截器)
 */
export function generateHmac(method, body, nonce, dateStr) {
  const data = `${method}\n${body}\n${nonce}\n${dateStr}`;
  const key = CryptoJS.enc.Base64.parse(HMAC_KEY);
  const hmac = CryptoJS.HmacSHA256(data, key);
  return CryptoJS.enc.Base64.stringify(hmac);
}

/**
 * 生成 HMAC headers
 */
export function makeHmacHeaders(method, data) {
  const nonce = generateNonce();
  const dateStr = new Date().toUTCString();
  const body = data ? JSON.stringify(data) : '{}';
  return {
    nonce: nonce,
    date: dateStr,
    digest: generateHmac(method, body, nonce, dateStr),
  };
}

function generateNonce() {
  let result = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < 36; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  // 设置 UUID v4 的第15位为 '4'
  result = result.substring(0, 14) + '4' + result.substring(15);
  // 设置第20位为 '8','9','a'或'b'
  const nineteenth = '89ab'[Math.floor(Math.random() * 4)];
  result = result.substring(0, 19) + nineteenth + result.substring(20);
  return result;
}
