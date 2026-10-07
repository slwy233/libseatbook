import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { login, getCaptcha, initSystemConfig } from '../api/client';
import { autoLoginWithCaptcha } from '../utils/ocr';
import { saveCredentials, getCredentials, saveUserInfo, saveToken, getSessionVersion, isSessionCurrent } from '../utils/storage';
import { colors } from '../theme';

export default function LoginScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [manualMode, setManualMode] = useState(!!route?.params?.forceReLogin);
  const [captchaText, setCaptchaText] = useState('');
  const [captchaData, setCaptchaData] = useState(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [autoStatus, setAutoStatus] = useState('');
  const [error, setError] = useState('');
  const passwordRef = useRef(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const captchaRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    getCredentials().then(creds => {
      if (!mounted.current) return;
      if (creds.username) setUsername(creds.username);
      if (creds.password) setPassword(creds.password);
    }).catch(() => { if (mounted.current) setError('无法读取本机账号，请手动输入'); });
    initSystemConfig().catch(e => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; captchaRequest.current++; };
  }, []);

  const fetchCaptcha = async (account = username.trim()) => {
    if (!account || busy.current) return;
    const id = ++captchaRequest.current;
    setCaptchaLoading(true); setCaptchaText(''); setCaptchaData(null);
    try {
      const result = await getCaptcha(account);
      if (mounted.current && id === captchaRequest.current) setCaptchaData(result);
    } catch (e) {
      if (mounted.current && id === captchaRequest.current) setError(e.message);
    } finally {
      if (mounted.current && id === captchaRequest.current) setCaptchaLoading(false);
    }
  };
  useEffect(() => {
    if (manualMode && username.trim()) fetchCaptcha();
    else { captchaRequest.current++; setCaptchaData(null); setCaptchaText(''); setCaptchaLoading(false); }
  }, [manualMode, username]);

  const submit = async () => {
    if (busy.current) return;
    const account = username.trim();
    if (!account || !password) { setError('请输入学号和密码'); return; }
    if (manualMode && (captchaLoading || !captchaData?.captchaId || !captchaText.trim())) {
      setError('请获取验证码并输入图片中的内容'); return;
    }
    const session = getSessionVersion();
    const active = () => mounted.current && isSessionCurrent(session);
    busy.current = true; setLoading(true); setError('');
    let retryManual = false;
    try {
      let result;
      if (manualMode) {
        result = await login(account, password, captchaData.captchaId, captchaText.trim(), { persistToken: false });
      } else {
        const attempt = await autoLoginWithCaptcha(
          () => getCaptcha(account),
          (id, text) => login(account, password, id, text, { persistToken: false }),
          5, (_, __, message) => { if (active()) setAutoStatus(message); },
        );
        if (!active()) return;
        if (!attempt.success) {
          setError(attempt.message);
          if (attempt.needManual) { setManualMode(true); retryManual = true; }
          return;
        }
        result = attempt.result;
      }
      if (!active()) return;
      await saveCredentials(account, password, session);
      if (!active()) return;
      await saveUserInfo(result.userInfo, session);
      if (!active()) return;
      const saved = await saveToken(result.token, { expectedVersion: session });
      if (saved && mounted.current) navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } catch (e) {
      if (active()) { setError(e.message); retryManual = manualMode; }
    } finally {
      busy.current = false;
      if (mounted.current) { setLoading(false); setAutoStatus(''); if (retryManual) fetchCaptcha(account); }
    }
  };
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.mark}><Text style={styles.markText}>书</Text></View>
        <Text style={styles.title}>天商书座</Text><Text style={styles.subtitle}>天津商业大学 · 图书馆座位预约</Text>
        <View style={styles.form}>
          <Text style={styles.formTitle}>登录你的账号</Text>
          <Text style={styles.label}>学号</Text>
          <TextInput style={styles.input} placeholder="请输入学号" value={username} onChangeText={value => { setUsername(value); setError(''); }} keyboardType="number-pad" autoCapitalize="none" autoCorrect={false} editable={!loading} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} accessibilityLabel="学号" />
          <Text style={styles.label}>密码</Text>
          <TextInput ref={passwordRef} style={styles.input} placeholder="请输入密码" value={password} onChangeText={setPassword} secureTextEntry editable={!loading} returnKeyType="done" onSubmitEditing={submit} accessibilityLabel="密码" />
          <View style={styles.modeRow}>
            <Text style={styles.modeLabel}>{manualMode ? '手动验证码' : '自动识别验证码'}</Text>
            <TouchableOpacity onPress={() => { setManualMode(!manualMode); setError(''); }} disabled={loading} style={styles.modeButton}><Text style={styles.link}>{manualMode ? '切换自动识别' : '使用手动输入'}</Text></TouchableOpacity>
          </View>
          {manualMode && <View style={styles.captchaRow}>
            <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="验证码" value={captchaText} onChangeText={setCaptchaText} editable={!loading} autoCapitalize="none" returnKeyType="done" onSubmitEditing={submit} />
            <TouchableOpacity style={styles.captcha} onPress={() => fetchCaptcha()} disabled={loading || captchaLoading || !username.trim()} accessibilityLabel="刷新验证码">
              {captchaLoading ? <ActivityIndicator color={colors.primary} /> : captchaData?.captchaImage ? <Image source={{ uri: captchaData.captchaImage.startsWith('data:') ? captchaData.captchaImage : 'data:image/png;base64,' + captchaData.captchaImage }} style={{ width: 110, height: 48 }} resizeMode="contain" /> : <Text style={styles.link}>获取验证码</Text>}
            </TouchableOpacity>
          </View>}
          {loading && autoStatus ? <Text style={styles.progress}>{autoStatus}</Text> : null}
          {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          <TouchableOpacity style={[styles.submit, loading && { opacity: 0.6 }]} onPress={submit} disabled={loading}>
            {loading ? <View style={styles.buttonRow}><ActivityIndicator color="#fff" /><Text style={styles.submitText}> 正在登录…</Text></View> : <Text style={styles.submitText}>登录</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>自动识别失败时可手动输入验证码。账号将保存在本机用于登录过期后的自动重登。</Text>
        </View>
        <Text style={styles.footer}>预约 · 学习 · 从容安排</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  mark: { width: 64, height: 64, backgroundColor: colors.primary, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, markText: { fontSize: 32, color: '#fff', fontWeight: '700' },
  title: { fontSize: 30, color: colors.text, fontWeight: '700', textAlign: 'center', marginTop: 16 }, subtitle: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 8, marginBottom: 28 },
  form: { backgroundColor: '#fff', borderRadius: 22, padding: 22, borderWidth: 1, borderColor: colors.border }, formTitle: { fontSize: 20, fontWeight: '600', color: colors.text, marginBottom: 18 },
  label: { color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 8 }, input: { backgroundColor: '#f8faff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, fontSize: 16, padding: 14, color: colors.text, marginBottom: 16 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modeLabel: { color: colors.muted, fontSize: 12 }, modeButton: { minHeight: 44, justifyContent: 'center' }, link: { color: colors.primary, fontSize: 12 },
  captchaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }, captcha: { width: 112, height: 52, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  progress: { color: colors.primary, fontSize: 13, lineHeight: 20, paddingVertical: 10 }, error: { color: colors.danger, fontSize: 13, lineHeight: 20, marginBottom: 12 },
  submit: { backgroundColor: colors.primary, borderRadius: 12, alignItems: 'center', padding: 15, marginTop: 8 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '600' }, buttonRow: { flexDirection: 'row', alignItems: 'center' },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 19, marginTop: 16 }, footer: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 24 },
});

