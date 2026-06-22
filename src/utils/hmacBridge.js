/**
 * HMAC Bridge — 隐藏WebView加载学校前端，用其axios内部方法调API
 * XHR无法复用axios拦截器，必须通过学校Vue组件方法调用
 */

let _callId = 0;
const _callbacks = new Map();
let _ready = false;
let _readyQueue = [];

export function setBridgeReady() {
  _ready = true;
  _readyQueue.forEach(fn => fn());
  _readyQueue = [];
}

/**
 * 处理WebView发来的消息
 */
export function handleBridgeMessage(raw) {
  try {
    const msg = JSON.parse(raw);
    const cb = _callbacks.get(msg.id);
    if (!cb) return;

    if (msg.type === 'bridgeReady') {
      setBridgeReady();
    } else if (msg.type === 'result') {
      _callbacks.delete(msg.id);
      clearTimeout(cb.timer);
      cb.resolve(msg.data);
    } else if (msg.type === 'error') {
      _callbacks.delete(msg.id);
      clearTimeout(cb.timer);
      cb.reject(new Error(msg.error));
    }
  } catch(e) {}
}

/**
 * 调用WebView中的JS函数
 */
function callWebView(webViewRef, js) {
  if (webViewRef && webViewRef.current) {
    webViewRef.current.injectJavaScript(js);
  }
}

/**
 * 等待bridge就绪后执行
 */
function whenReady(webViewRef, fn) {
  if (_ready) {
    fn();
  } else {
    _readyQueue.push(fn);
  }
}

/**
 * 通过WebView调用认证API
 * 原理: 调用学校Vue组件的方法(getUserInfoFn等),数据自动存到组件state里
 */
export function bridgeCall(webViewRef, method, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++_callId;
    const timer = setTimeout(() => {
      _callbacks.delete(id);
      reject(new Error('Bridge timeout'));
    }, 20000);

    _callbacks.set(id, { resolve, reject, timer });

    // 这些是学校Vue根组件的方法
    const methodMap = {
      getUserInfo: 'getUserInfoFn',
      getCurrentMake: 'getCurrentBook',
    };

    const vueMethod = methodMap[method] || method;

    whenReady(webViewRef, () => {
      const js = `
        (function() {
          try {
            var app = document.querySelector('#app').__vue__;
            if (!app || !app.${vueMethod}) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type:'error', id:${id}, error:'Vue method ${vueMethod} not found'
              }));
              return;
            }
            var result = app.${vueMethod}();
            if (result && result.then) {
              result.then(function() {
                // 数据已存入Vue响应式state, 发送state给RN
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type:'result', id:${id},
                  data: { status:true, data: app.userInfo || app.$data }
                }));
              }).catch(function(e) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type:'error', id:${id}, error: e.message || 'api error'
                }));
              });
            } else {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type:'result', id:${id},
                data: { status:true }
              }));
            }
          } catch(e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type:'error', id:${id}, error: e.message
            }));
          }
        })();
        true;
      `;
      callWebView(webViewRef, js);
    });
  });
}
