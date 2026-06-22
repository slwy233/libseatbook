/**
 * WebView HMAC 桥接 — 用学校前端自己的JS处理认证请求
 *
 * 原理: React Native 的 HMAC 签名被服务器拒绝。
 * 解决方案: 在隐藏 WebView 中加载学校页面，调用其内部的 Vue 方法获取数据，
 * 从而利用学校前端自己的 axios 拦截器来生成正确的 HMAC 签名。
 */

import { Platform } from 'react-native';
import { getSystemInfo } from './storage';

let bridgeReady = false;
let pendingRequests = [];

const BRIDGE_HTML = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="app"></div>
<script>
// 加载学校的JS库和前端代码
var script1 = document.createElement('script');
script1.src = 'https://libseat.tjcu.edu.cn/jsq-v/static/js/crypto-js.min.js';
document.body.appendChild(script1);

var script2 = document.createElement('script');
script2.src = 'https://libseat.tjcu.edu.cn/jsq-v/static/config.js';
document.body.appendChild(script2);

script2.onload = function() {
    // 获取系统配置
    fetch('https://libseat.tjcu.edu.cn/jsq/static/public/cg/getSysSet/PC', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'logintype': 'PC'},
        body: '{}'
    }).then(r => r.json()).then(function(sysData) {
        var info = sysData.data;
        function genNonce() {
            var chars = '0123456789abcdef', r = [];
            for (var i = 0; i < 36; i++) r[i] = chars.substr(Math.floor(16*Math.random()), 1);
            r[14] = '4';
            r[19] = chars.substr(Math.floor(4*Math.random()), 1);
            return r.join('');
        }

        // 挂载API到全局，供RN调用
        window.bridgeCall = function(token, path, bodyStr) {
            return new Promise(function(resolve, reject) {
                var method = 'POST';
                var body = bodyStr || '{}';
                var id = genNonce();
                var date = Date.now().toString();
                var signStr = method + '\\n' + body + '\\n' + id + '\\n' + date;
                var key = CryptoJS.enc.Base64.parse(info.hmacKey);
                var hmac = CryptoJS.HmacSHA256(signStr, key).toString();

                var xhr = new XMLHttpRequest();
                xhr.open('POST', 'https://libseat.tjcu.edu.cn' + path);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('logintype', 'PC');
                if (token) xhr.setRequestHeader('token', token);
                xhr.setRequestHeader('x-request-id', id);
                xhr.setRequestHeader('x-request-date', date);
                xhr.setRequestHeader('x-hmac-request-key', hmac);
                xhr.onload = function() {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch(e) { reject(e); }
                };
                xhr.onerror = function() { reject(new Error('network error')); };
                xhr.send(body);
            });
        };

        // 通知RN桥接就绪
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ready'}));
    });
};
</script>
</body></html>
`;

export { BRIDGE_HTML };

/**
 * 通过 WebView 桥接调用认证API
 * 需要在包含 WebView 的组件中使用
 */
export function createBridgeAPI(webViewRef) {
  return {
    async call(token, path, body = '{}') {
      if (!webViewRef.current) throw new Error('WebView未就绪');

      return new Promise((resolve, reject) => {
        const js = `
          (async function() {
            try {
              var result = await window.bridgeCall('${token}', '${path}', '${JSON.stringify(body)}');
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'result',
                path: '${path}',
                data: result
              }));
            } catch(e) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'error',
                path: '${path}',
                error: e.message
              }));
            }
          })();
          true;
        `;
        webViewRef.current.injectJavaScript(js);

        // 超时处理
        const timeout = setTimeout(() => reject(new Error('请求超时')), 15000);
        // TODO: 需要全局消息监听器来接收 WebView 响应
        // 这部分需要在组件中实现
      });
    }
  };
}
