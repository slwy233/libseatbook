import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { login, getCaptcha, initSystemConfig } from '../api/client';
import { autoLoginWithCaptcha } from '../utils/ocr';
import { saveCredentials, getCredentials, saveUserInfo } from '../utils/storage';

export default function LoginScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // 手动验证码 (5次自动重试失败后展示)
  const [manualMode, setManualMode] = useState(false);
  const [captchaText, setCaptchaText] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaImage, setCaptchaImage] = useState(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);

  // 自动登录进度
  const [autoStatus, setAutoStatus] = useState('');
  const [autoAttempt, setAutoAttempt] = useState(0);

  const passwordRef = useRef(null);
  const captchaRef = useRef(null);

  useEffect(() => {
    (async () => {
      const creds = await getCredentials();
      if (creds.username) setUsername(creds.username);
      if (creds.password) setPassword(creds.password);
      try { await initSystemConfig(); } catch (e) {}
    })();
  }, []);

  // 手动获取验证码
  const fetchCaptcha = async () => {
    if (!username.trim()) {
      Alert.alert('提示', '请先输入学号');
      return;
    }
    setCaptchaLoading(true);
    setCaptchaText('');
    try {
      const result = await getCaptcha(username.trim());
      setCaptchaId(result.captchaId);
      setCaptchaImage(result.captchaImage);
    } catch (e) {
      Alert.alert('获取验证码失败', e.message || '网络错误，请重试');
    } finally {
      setCaptchaLoading(false);
    }
  };

  // 手动登录
  const handleManualLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('提示', '学号和密码不能为空');
      return;
    }
    setLoading(true);
    try {
      const result = await login(
        username.trim(), password,
        captchaId, captchaText || '-1'
      );
      await saveCredentials(username.trim(), password);
      await saveUserInfo(result.userInfo);
      navigation.replace('Main');
    } catch (e) {
      Alert.alert('登录失败', e.message || '未知错误');
      fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  // 自动登录主流程: OCR识别 → 重试5次 → 失败则手动
  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('提示', '学号和密码不能为空');
      return;
    }

    setLoading(true);
    setManualMode(false);
    setAutoStatus('正在获取验证码...');
    setAutoAttempt(0);

    try {
      const result = await autoLoginWithCaptcha(
        async () => await getCaptcha(username.trim()),
        async (cid, ctext) => await login(username.trim(), password, cid, ctext),
        5,
        (attempt, status, msg) => {
          setAutoAttempt(attempt);
          setAutoStatus(msg);
        }
      );

      if (result.success) {
        await saveCredentials(username.trim(), password);
        await saveUserInfo(result.result.userInfo);
        setAutoStatus('登录成功! 🎉');
        setTimeout(() => navigation.replace('Main'), 400);
        return;
      }

      if (result.needManual) {
        setManualMode(true);
        setAutoStatus('');
        if (result.captchaImage) {
          setCaptchaImage(result.captchaImage);
          setCaptchaId(result.captchaId || '');
        } else {
          fetchCaptcha();
        }
        Alert.alert(
          '需要手动输入',
          result.message || '自动识别失败，请输入验证码',
          [{ text: '好的' }]
        );
        return;
      }

      // 非验证码错误
      Alert.alert('登录失败', result.message);
      setAutoStatus('');
    } catch (e) {
      Alert.alert('错误', e.message || '网络异常');
      setAutoStatus('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.appName}>📚 图书馆座位预约</Text>
          <Text style={styles.subtitle}>天津商业大学</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>学号</Text>
            <TextInput
              style={styles.input}
              placeholder="请输入学号"
              value={username}
              onChangeText={setUsername}
              keyboardType="number-pad"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              autoCapitalize="none"
              editable={!loading}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>密码</Text>
            <TextInput
              ref={passwordRef}
              style={styles.input}
              placeholder="请输入密码"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              editable={!loading}
            />
          </View>

          {/* 自动登录进度 */}
          {loading && !manualMode && (
            <View style={styles.statusBar}>
              <ActivityIndicator size="small" color="#1677FF" />
              <Text style={styles.statusText}>{autoStatus}</Text>
              {autoAttempt > 0 && (
                <Text style={styles.attemptText}>{autoAttempt}/5</Text>
              )}
            </View>
          )}

          {/* 手动验证码 (5次重试失败后出现) */}
          {manualMode && (
            <View style={styles.captchaBox}>
              <Text style={styles.captchaHint}>
                🔍 自动识别失败，请输入验证码
              </Text>
              <View style={styles.captchaRow}>
                <TextInput
                  ref={captchaRef}
                  style={[styles.input, styles.captchaInput]}
                  placeholder="输入验证码"
                  value={captchaText}
                  onChangeText={setCaptchaText}
                  returnKeyType="done"
                  onSubmitEditing={handleManualLogin}
                  autoCapitalize="none"
                  editable={!loading}
                />
                <TouchableOpacity
                  style={styles.captchaImgBtn}
                  onPress={fetchCaptcha}
                  disabled={captchaLoading}
                  activeOpacity={0.7}
                >
                  {captchaLoading ? (
                    <ActivityIndicator size="small" color="#1677FF" />
                  ) : captchaImage ? (
                    <Image
                      source={{ uri: captchaImage }}
                      style={styles.captchaImg}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text style={styles.captchaBtnText}>点击获取{'\n'}验证码</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 登录按钮 */}
          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={manualMode ? handleManualLogin : handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <View style={styles.btnRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.loginBtnText}>
                  {manualMode ? '  登录中...' : '  自动识别中...'}
                </Text>
              </View>
            ) : (
              <Text style={styles.loginBtnText}>
                {manualMode ? '手动登录' : '登 录'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.tip}>
            💡 自动获取验证码并OCR识别，最多重试5次{'\n'}
            失败后展示验证码图片供手动输入
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  appName: { fontSize: 26, fontWeight: 'bold', color: '#1677FF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#999' },

  form: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },

  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
    backgroundColor: '#fafafa', color: '#333',
  },

  // 自动登录进度
  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f0f5ff', borderRadius: 10, padding: 12,
    marginBottom: 16, gap: 10,
  },
  statusText: { flex: 1, fontSize: 13, color: '#1677FF' },
  attemptText: { fontSize: 12, color: '#999' },

  // 手动验证码
  captchaBox: {
    backgroundColor: '#fffbe6', borderRadius: 10, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: '#ffe58f',
  },
  captchaHint: { fontSize: 13, color: '#ad6800', marginBottom: 10 },
  captchaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  captchaInput: { flex: 1 },
  captchaImgBtn: {
    width: 120, height: 48, borderWidth: 1, borderColor: '#d9d9d9',
    borderRadius: 8, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#fafafa', overflow: 'hidden',
  },
  captchaImg: { width: 120, height: 48 },
  captchaBtnText: { fontSize: 11, color: '#1677FF', textAlign: 'center', lineHeight: 16 },

  // 登录按钮
  loginBtn: {
    backgroundColor: '#1677FF', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  btnRow: { flexDirection: 'row', alignItems: 'center' },
  tip: { fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 16, lineHeight: 18 },
});
