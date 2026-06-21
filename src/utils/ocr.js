/**
 * 验证码 OCR 识别
 *
 * 使用 OCR.space 免费 API
 * 支持算式验证码 (如 "3-4=?" → "-1") 和字母数字验证码
 */

const OCR_API = 'https://api.ocr.space/parse/image';
const API_KEY = 'helloworld';

/**
 * OCR 识别 base64 验证码图片
 */
async function ocrImage(base64Image) {
  const imageData = base64Image.startsWith('data:')
    ? base64Image
    : `data:image/png;base64,${base64Image}`;

  const fd = new FormData();
  fd.append('base64Image', imageData);
  fd.append('language', 'eng');
  fd.append('isOverlayRequired', 'false');
  fd.append('OCREngine', '2');
  fd.append('scale', 'true');
  fd.append('detectOrientation', 'false');

  const resp = await fetch(OCR_API, {
    method: 'POST',
    headers: { apikey: API_KEY },
    body: fd,
  });

  const json = await resp.json();
  if (json.OCRExitCode === 1 && json.ParsedResults?.length > 0) {
    return (json.ParsedResults[0].ParsedText || '').trim();
  }
  return '';
}

/**
 * 判断是否为算式: 包含运算符
 */
function isMathExpr(text) {
  return /[+\-×*÷/]/.test(text);
}

/**
 * 算式求解: "3-4=" → "-1"
 */
function solveMath(text) {
  let expr = text.replace(/[=?\s]/g, '');
  expr = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/[xX]/g, '*');

  const m = expr.match(/(-?\d+)\s*([+\-*/])\s*(\d+)/);
  if (!m) return null;

  const a = parseInt(m[1], 10);
  const b = parseInt(m[3], 10);
  switch (m[2]) {
    case '+': return String(a + b);
    case '-': return String(a - b);
    case '*': return String(a * b);
    case '/': return b !== 0 ? String(Math.floor(a / b)) : '0';
    default:  return null;
  }
}

/**
 * 清理字母数字结果
 */
function cleanText(text) {
  let s = text.replace(/[\s\n\r]/g, '').replace(/[^a-zA-Z0-9]/g, '');
  if (s.length > 6) s = s.substring(0, 6);
  return s;
}

/**
 * 识别验证码: 自动判断算式/字母数字类型
 */
export async function recognizeCaptcha(base64Image) {
  const raw = await ocrImage(base64Image);
  if (!raw) return '';

  console.log(`[OCR] raw: "${raw}"`);

  if (isMathExpr(raw)) {
    const ans = solveMath(raw);
    if (ans !== null) {
      console.log(`[OCR] math: "${raw}" → "${ans}"`);
      return ans;
    }
  }

  const cleaned = cleanText(raw);
  console.log(`[OCR] text: "${cleaned}"`);
  return cleaned;
}

/**
 * 自动登录: 获取验证码 → OCR → 登录
 * 失败一次直接切手动输入，不浪费时间重试
 *
 * @param {Function} getCaptchaFn - () => {captchaId, captchaImage}
 * @param {Function} loginFn - (captchaId, captchaText) => {token, userInfo}
 * @param {Function} onProgress - (status, message) => void
 * @returns {{success, needManual, captchaImage, captchaId, result, message}}
 */
export async function autoLoginWithCaptcha(
  getCaptchaFn,
  loginFn,
  onProgress = null
) {
  // 1. 获取验证码
  if (onProgress) onProgress('fetching', '获取验证码...');
  let captchaData;
  try {
    captchaData = await getCaptchaFn();
  } catch (e) {
    return {
      success: false,
      needManual: true,
      message: '获取验证码失败: ' + (e.message || '网络错误'),
    };
  }

  // 2. OCR 识别
  if (onProgress) onProgress('ocr', '识别验证码...');
  let captchaText;
  try {
    captchaText = await recognizeCaptcha(captchaData.captchaImage);
  } catch (e) {
    captchaText = '';
  }

  if (!captchaText || captchaText.length < 1) {
    // OCR 失败 → 直接切手动，带上验证码图片
    return {
      success: false,
      needManual: true,
      captchaImage: captchaData.captchaImage,
      captchaId: captchaData.captchaId,
      message: 'OCR识别失败，请手动输入验证码',
    };
  }

  // 3. 尝试登录
  if (onProgress) onProgress('login', `尝试登录 (${captchaText})...`);
  try {
    const result = await loginFn(captchaData.captchaId, captchaText);
    if (result && result.token) {
      return {
        success: true,
        needManual: false,
        result,
        message: '登录成功',
      };
    }
    // 验证码错误 → 手动
    return {
      success: false,
      needManual: true,
      captchaImage: captchaData.captchaImage,
      captchaId: captchaData.captchaId,
      message: '验证码错误，请手动输入',
    };
  } catch (e) {
    const msg = e.message || '';
    // 密码/账号错误 → 直接报，不重试
    if (/密码|学号|账号|用户|不存在|禁用/.test(msg)) {
      return { success: false, needManual: false, message: msg };
    }
    // 其他错误 → 手动
    return {
      success: false,
      needManual: true,
      captchaImage: captchaData.captchaImage,
      captchaId: captchaData.captchaId,
      message: msg || '登录失败，请手动重试',
    };
  }
}
