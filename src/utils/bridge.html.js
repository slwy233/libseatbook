// 供 WebView 加载的 HTML
// 加载学校前端，用其 Vue 组件的内部方法调 API（HMac由学校自己的axios拦截器处理）

export const BRIDGE_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f7fa;">
<div id="app"></div>
<script src="https://libseat.tjcu.edu.cn/jsq-v/static/config.js"></script>
<script src="https://libseat.tjcu.edu.cn/jsq-v/static/js/crypto-js.min.js"></script>
<script src="https://libseat.tjcu.edu.cn/jsq-v/static/js/jsencrypt.js"></script>
<script src="https://libseat.tjcu.edu.cn/jsq-v/static/js/tac.min.js"></script>
<script src="https://libseat.tjcu.edu.cn/jsq-v/static/js/manifest.3ad1d5771e9b13dbdad2.js"></script>
<script src="https://libseat.tjcu.edu.cn/jsq-v/static/js/vendor.52d41d8a904f0a687399.js"></script>
<script src="https://libseat.tjcu.edu.cn/jsq-v/static/js/app.e772d3e491777ee22b21.js"></script>
<script>
var _ready = false;
var _pending = [];
var _callId = 0;

function post(msg) {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg));
}

// 轮询等待 Vue 初始化完成
var _checkTimer = setInterval(function() {
    var app = document.querySelector('#app');
    var vue = app && app.__vue__;
    if (vue && vue.getUserInfoFn && !_ready) {
        _ready = true;
        clearInterval(_checkTimer);
        post({type: 'ready'});

        // 处理积压的调用
        _pending.forEach(function(p) { doCall(p.id, p.path); });
        _pending = [];
    }
}, 200);

// 超时
setTimeout(function() {
    if (!_ready) {
        clearInterval(_checkTimer);
        post({type: 'error', msg: 'WebView初始化超时'});
    }
}, 15000);

// 监听从RN发来的消息
window.addEventListener('message', function(e) {
    try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'setToken') {
            sessionStorage.setItem('token', msg.token);
            sessionStorage.setItem('loginType', 'login');
            sessionStorage.setItem('loginType', 'login');
        } else if (msg.type === 'call') {
            if (_ready) {
                doCall(msg.id, msg.path);
            } else {
                _pending.push({id: msg.id, path: msg.path});
            }
        }
    } catch(ex) {}
});

document.addEventListener('message', function(e) {
    try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'setToken') {
            sessionStorage.setItem('token', msg.token);
            sessionStorage.setItem('loginType', 'login');
        } else if (msg.type === 'call') {
            if (_ready) doCall(msg.id, msg.path);
            else _pending.push({id: msg.id, path: msg.path});
        }
    } catch(ex) {}
});

function doCall(id, path) {
    var app = document.querySelector('#app').__vue__;
    if (!app) {
        post({type: 'callResult', id: id, error: 'no vue app'});
        return;
    }

    // 根据path调用对应的Vue方法
    try {
        if (path === '/static/frontApi/user/getUserInfo') {
            app.getUserInfoFn().then ?
                app.getUserInfoFn().then(function(r) {
                    post({type: 'callResult', id: id, resp: r && r.data ? r.data : r});
                }) :
                post({type: 'callResult', id: id, resp: 'ok'});
        } else if (path === '/static/frontApi/res/buildingFloorDate') {
            // 这个方法可能直接返回Promise
            var r = app.$options && app.$options.methods;
            // 尝试从全局fetchPost调用
            var xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://libseat.tjcu.edu.cn' + path);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('logintype', 'PC');
            var tok = sessionStorage.getItem('token');
            if (tok) xhr.setRequestHeader('token', tok);
            xhr.onload = function() {
                post({type: 'callResult', id: id, resp: JSON.parse(xhr.responseText)});
            };
            xhr.onerror = function() {
                post({type: 'callResult', id: id, error: 'network error'});
            };
            xhr.send('{}');
        } else {
            post({type: 'callResult', id: id, error: 'unknown path: ' + path});
        }
    } catch(e) {
        post({type: 'callResult', id: id, error: e.message});
    }
}
</script>
</body>
</html>
`;
