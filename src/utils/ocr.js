/**
 * 验证码 OCR 识别
 * - 多引擎依次尝试
 * - 格式验证过滤误识别
 * - 5次重试自动登录
 */

const OCR_API = 'https://api.ocr.space/parse/image';
const API_KEY = 'helloworld';

/**
 * OCR 单次识别
 */
async function ocrImage(base64Image, engine = '2') {
  const imageData = base64Image.startsWith('data:') ? base64Image : `data:image/png;base64,${base64Image}`;
  const fd = new FormData();
  fd.append('base64Image', imageData);
  fd.append('language', 'eng');
  fd.append('isOverlayRequired', 'false');
  fd.append('OCREngine', engine);
  fd.append('scale', 'true');
  fd.append('detectOrientation', 'false');

  try {
    const resp = await fetch(OCR_API, { method: 'POST', headers: { apikey: API_KEY }, body: fd });
    const json = await resp.json();
    if (json.OCRExitCode === 1 && json.ParsedResults?.length > 0) {
      return (json.ParsedResults[0].ParsedText || '').trim();
    }
  } catch(e) {
    console.log('[OCR] fetch error:', e.message);
  }
  return '';
}

function clean(raw) {
  return raw.replace(/[\s\n\r]/g, '').replace(/[^a-zA-Z0-9+\-×*÷/=xX?]/g, '');
}

function isMath(text) {
  return /[+\-×*÷/xX]/.test(text);
}

function solveMath(text) {
  let expr = text.replace(/[=?\s]/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/[xX]/g, '*');
  const m = expr.match(/(-?\d+)\s*([+\-*/])\s*(\d+)/);
  if (!m) return null;
  const a = parseInt(m[1], 10), b = parseInt(m[3], 10);
  switch (m[2]) {
    case '+': return String(a + b);
    case '-': return String(a - b);
    case '*': return String(a * b);
    case '/': return b !== 0 ? String(Math.floor(a / b)) : '0';
    default: return null;
  }
}

/**
 * 验证结果是否合法
 */
function valid(text) {
  if (!text || text.length < 1) return false;
  if (/^-?\d{1,3}$/.test(text)) return true;           // 算式结果
  if (/^[a-zA-Z0-9]{3,4}$/.test(text)) return true;    // 3-4位验证码
  return false;
}

/**
 * 智能识别: 多引擎 + 格式验证
 */
export async function recognizeCaptcha(base64Image) {
  const engines = ['2', '1', '3'];
  const results = [];

  for (const engine of engines) {
    const raw = await ocrImage(base64Image, engine);
    if (!raw) continue;
    console.log(`[OCR E${engine}] "${raw}"`);

    const c = clean(raw);

    // 算式类型
    if (isMath(c)) {
      const ans = solveMath(c);
      if (ans !== null && valid(ans)) {
        console.log(`[OCR] ✓ 算式="${c}" → ${ans}`);
        return ans;
      }
      results.push({ text: 'math:' + c, score: 1 });
      continue;
    }

    // 字母数字类型
    const alpha = c.replace(/[^a-zA-Z0-9]/g, '');
    if (valid(alpha)) {
      console.log(`[OCR] ✓ 验证码="${alpha}"`);
      return alpha;
    }
    if (alpha.length >= 2) results.push({ text: alpha, score: alpha.length });
  }

  // 降级: 返回最佳结果
  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  if (best) {
    const t = best.text.startsWith('math:') ? best.text.substring(5) : best.text;
    console.log(`[OCR] ⚠ 降级使用: "${t}"`);
    return t.substring(0, 6);
  }

  return '';
}

/**
 * 自动登录
 */
export async function autoLoginWithCaptcha(
  getCaptchaFn,
  loginFn,
  maxRetries = 5,
  onProgress = null
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (onProgress) onProgress(attempt, 'fetching', `获取验证码 (${attempt}/${maxRetries})...`);
    let captchaData;
    try {
      captchaData = await getCaptchaFn();
    } catch (e) {
      if (onProgress) onProgress(attempt, 'error', `获取失败`);
      continue;
    }

    if (onProgress) onProgress(attempt, 'ocr', 'OCR识别中...');
    let captchaText;
    try {
      captchaText = await recognizeCaptcha(captchaData.captchaImage);
    } catch (e) {
      captchaText = '';
    }

    if (!captchaText || captchaText.length < 1) {
      if (onProgress) onProgress(attempt, 'ocr_fail', '未识别，重试...');
      continue;
    }

    if (onProgress) onProgress(attempt, 'login', `验证码: ${captchaText}，登录中...`);
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
