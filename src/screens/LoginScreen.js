import React, { useEffect, useRef, useState } from 'react';
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

const AUTO_LOGIN_RETRIES = 5;

export default function LoginScreen({ navigation, route }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [captchaText, setCaptchaText] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaImage, setCaptchaImage] = useState(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [autoStatus, setAutoStatus] = useState('');
  const [autoAttempt, setAutoAttempt] = useState(0);

  const passwordRef = useRef(null);
  const captchaRef = useRef(null);
  const forceReloginHandledRef = useRef(false);

  useEffect(() => {
    (async () => {
      const credentials = await getCredentials();
      if (credentials.username) {
        setUsername(credentials.username);
      }
      if (credentials.password) {
        setPassword(credentials.password);
      }
      try {
        await initSystemConfig();
      } catch (error) {
        console.log('初始化系统配置失败:', error?.message || error);
      }
    })();
  }, []);

  useEffect(() => {
    if (!route?.params?.forceReLogin || forceReloginHandledRef.current) {
      return;
    }

    if (!username.trim()) {
      return;
    }

    forceReloginHandledRef.current = true;
    setManualMode(true);

    setTimeout(() => {
      fetchCaptcha();
    }, 300);
  }, [route?.params?.forceReLogin, username]);

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
    } catch (error) {
      Alert.alert('获取验证码失败', error?.message || '网络错误，请重试');
    } finally {
      setCaptchaLoading(false);
    }
  };

  const handleManualLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('提示', '学号和密码不能为空');
      return;
    }

    setLoading(true);

    try {
      const result = await login(
        username.trim(),
        password,
        captchaId,
        captchaText || '-1'
      );
      await saveCredentials(username.trim(), password);
      await saveUserInfo(result.userInfo);
      navigation.replace('Main');
    } catch (error) {
      Alert.alert('登录失败', error?.message || '未知错误');
      await fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

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
        async (id, text) => await login(username.trim(), password, id, text),
        AUTO_LOGIN_RETRIES,
        (attempt, status, message) => {
          setAutoAttempt(attempt);
          setAutoStatus(message || status);
        }
      );

      if (result.success) {
        await saveCredentials(username.trim(), password);
        await saveUserInfo(result.result.userInfo);
        setAutoStatus('登录成功');
        setTimeout(() => navigation.replace('Main'), 300);
        return;
      }

      if (result.needManual) {
        setManualMode(true);
        setAutoStatus('');
        if (result.captchaImage) {
          setCaptchaImage(result.captchaImage);
          setCaptchaId(result.captchaId || '');
        } else {
          await fetchCaptcha();
        }
        Alert.alert('需要手动输入', result.message || '自动识别失败，请手动输入验证码');
        return;
      }

      Alert.alert('登录失败', result.message || '登录失败');
      setAutoStatus('');
    } catch (error) {
      Alert.alert('错误', error?.message || '网络异常');
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

          {loading && !manualMode && (
            <View style={styles.statusBar}>
              <ActivityIndicator size="small" color="#1677FF" />
              <Text style={styles.statusText}>{autoStatus}</Text>
              {autoAttempt > 0 && (
                <Text style={styles.attemptText}>{autoAttempt}/{AUTO_LOGIN_RETRIES}</Text>
              )}
            </View>
          )}

          {manualMode && (
            <View style={styles.captchaBox}>
              <Text style={styles.captchaHint}>📝 自动识别失败，请手动输入验证码</Text>
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
                    <Text style={styles.captchaBtnText}>点击获取{`\n`}验证码</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

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
                {manualMode ? '手动登录' : '登录'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.tip}>
            💡 自动获取验证码并 OCR 识别，最多重试 {AUTO_LOGIN_RETRIES} 次{`\n`}
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
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
    color: '#333',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f5ff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  statusText: { flex: 1, fontSize: 13, color: '#1677FF' },
  attemptText: { fontSize: 12, color: '#999' },
  captchaBox: {
    backgroundColor: '#fffbe6',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ffe58f',
  },
  captchaHint: { fontSize: 13, color: '#ad6800', marginBottom: 10 },
  captchaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  captchaInput: { flex: 1 },
  captchaImgBtn: {
    width: 120,
    height: 48,
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fafafa',
    overflow: 'hidden',
  },
  captchaImg: { width: 120, height: 48 },
  captchaBtnText: { fontSize: 11, color: '#1677FF', textAlign: 'center', lineHeight: 16 },
  loginBtn: {
    backgroundColor: '#1677FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  btnRow: { flexDirection: 'row', alignItems: 'center' },
  tip: { fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 16, lineHeight: 18 },
});
