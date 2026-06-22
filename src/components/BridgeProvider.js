import React, { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { getToken, getSystemInfo } from '../utils/storage';

// 隐藏WebView — 加载学校前端，提供认证API代理
export default function BridgeProvider({ children, onReady }) {
  const webViewRef = useRef(null);
  const readyRef = useRef(false);

  useEffect(() => {
    // 等WebView加载完毕就标记就绪
    const timer = setTimeout(() => {
      if (!readyRef.current) {
        readyRef.current = true;
        // 注入token
        injectToken();
        if (onReady) onReady();
      }
    }, 5000); // 5秒超时
    return () => clearTimeout(timer);
  }, []);

  const injectToken = async () => {
    const token = await getToken();
    const sysInfo = await getSystemInfo();
    const vueConfig = sysInfo?.vueConfig || {};

    if (webViewRef.current && token) {
      const js = `
        sessionStorage.setItem('token','${token}');
        sessionStorage.setItem('loginType','login');
        sessionStorage.setItem('systemInfo',JSON.stringify(${JSON.stringify(sysInfo)}));
        sessionStorage.setItem('vueConfig',JSON.stringify(${JSON.stringify(vueConfig)}));
        window.__bridgeReady = true;
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'bridgeReady'}));
        true;
      `;
      webViewRef.current.injectJavaScript(js);
    }
  };

  const handleMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      // 转发消息到全局处理器
      if (typeof global.onBridgeMessage === 'function') {
        global.onBridgeMessage(msg);
      }
    } catch(e) {}
  };

  return (
    <View style={styles.container}>
      {children}
      {/* 隐藏的1x1 WebView — 仅用于加载学校JS和提供axios代理 */}
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://libseat.tjcu.edu.cn/jsq-v/' }}
        style={styles.hidden}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={handleMessage}
        onLoadEnd={() => {
          if (!readyRef.current) {
            readyRef.current = true;
            injectToken();
            if (onReady) onReady();
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hidden: { width: 1, height: 1, opacity: 0, position: 'absolute', top: -999 },
});
