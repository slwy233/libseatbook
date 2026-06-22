/**
 * 验证码 OCR 识别
 *
 * 使用 OCR.space 免费 API
 * 支持算式验证码 (如 "3-4=?" → "-1") 和字母数字验证码
 */

const OCR_API = 'https://api.ocr.space/parse/image';
const API_KEY = 'helloworld';

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

function isMathExpr(text) {
  return /[+\-×*÷/]/.test(text);
}

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

function cleanText(text) {
  let s = text.replace(/[\s\n\r]/g, '').replace(/[^a-zA-Z0-9]/g, '');
  if (s.length > 6) s = s.substring(0, 6);
  return s;
}

export async function recognizeCaptcha(base64Image) {
  const raw = await ocrImage(base64Image);
  if (!raw) return '';
  if (isMathExpr(raw)) {
    const ans = solveMath(raw);
    if (ans !== null) return ans;
  }
  return cleanText(raw);
}

/**
 * 自动登录: 获取验证码 → OCR → 登录，最多重试 maxRetries 次
 */
export async function autoLoginWithCaptcha(
  getCaptchaFn,
  loginFn,
  maxRetries = 5,
  onProgress = null
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 1. 获取验证码
    if (onProgress) onProgress(attempt, 'fetching', `获取验证码 (第${attempt}次)...`);
    let captchaData;
    try {
      captchaData = await getCaptchaFn();
    } catch (e) {
      if (onProgress) onProgress(attempt, 'error', `获取失败: ${e.message}`);
      continue;
    }

    // 2. OCR
    if (onProgress) onProgress(attempt, 'ocr', 'OCR识别中...');
    let captchaText;
    try {
      captchaText = await recognizeCaptcha(captchaData.captchaImage);
    } catch (e) {
      captchaText = '';
    }

    if (!captchaText || captchaText.length < 1) {
      if (onProgress) onProgress(attempt, 'ocr_fail', '未能识别，重试...');
      continue;
    }

    // 3. 登录
    if (onProgress) onProgress(attempt, 'login', `尝试登录 (${captchaText})...`);
    try {
      const result = await loginFn(captchaData.captchaId, captchaText);
      if (result && result.token) {
        if (onProgress) onProgress(attempt, 'success', '登录成功!');
        return { success: true, needManual: false, result, message: '登录成功' };
      }
      if (onProgress) onProgress(attempt, 'retry', '验证码错误，重试...');
    } catch (e) {
      const msg = e.message || '';
      if (/密码|学号|账号|用户|不存在|禁用/.test(msg)) {
        return { success: false, needManual: false, message: msg };
      }
      if (onProgress) onProgress(attempt, 'retry', msg);
    }
  }

  return {
    success: false,
    needManual: true,
    message: `自动识别 ${maxRetries} 次均失败，请手动输入`,
  };
}
