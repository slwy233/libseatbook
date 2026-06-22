import React, { useRef, useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { getToken, getSystemInfo } from '../utils/storage';

const SCHOOL_URL = 'https://libseat.tjcu.edu.cn/jsq-v/';

export default function WebViewScreen() {
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [injectedJs, setInjectedJs] = useState('');

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const sysInfo = await getSystemInfo();
      const vueConfig = sysInfo?.vueConfig || {};

      const js = `
        (function() {
          if ('${token}') {
            sessionStorage.setItem('token', '${token}');
            sessionStorage.setItem('loginType', 'login');
          }
          var sysInfo = ${JSON.stringify(sysInfo)};
          if (sysInfo) sessionStorage.setItem('systemInfo', JSON.stringify(sysInfo));
          var vueConfig = ${JSON.stringify(vueConfig)};
          if (vueConfig) sessionStorage.setItem('vueConfig', JSON.stringify(vueConfig));
          true;
        })();
      `;
      setInjectedJs(js);
    })();
  }, []);

  if (!injectedJs) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#1677FF" style={{marginTop:100}} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1677FF" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      )}
      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>📡</Text>
          <Text style={styles.errorText}>网络连接失败</Text>
          <Text style={styles.errorHint}>请检查网络后重试</Text>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: SCHOOL_URL }}
          injectedJavaScriptBeforeContentLoaded={injectedJs}
          onLoadEnd={() => setLoading(false)}
          onError={(e) => { console.log('WebView error:', e.nativeEvent); setLoading(false); setError(true); }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          style={styles.webview}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7fa', zIndex: 10 },
  loadingText: { marginTop: 12, color: '#999', fontSize: 14 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7fa' },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  errorText: { fontSize: 16, color: '#666' },
  errorHint: { fontSize: 13, color: '#999', marginTop: 8 },
  webview: { flex: 1 },
});
