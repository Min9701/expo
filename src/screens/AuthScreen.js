import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MONO } from '../components/KeyRow';
import { deriveIdentity, generatePrivateKey, isValidPrivateKey } from '../crypto/keys';
import { decryptPrivateKey, encryptPrivateKey } from '../crypto/vault';
import { loadAccount, saveAccount } from '../storage/persist';

export default function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = (next) => {
    setMode(next);
    setError('');
    setPassword('');
    setPrivateKey('');
  };

  const genKey = async () => {
    setPrivateKey(await generatePrivateKey());
    setError('');
  };

  const submit = async () => {
    setError('');
    const name = username.trim().toLowerCase();
    if (!name) return setError('Chưa nhập tên đăng nhập.');
    if (!password) return setError('Chưa nhập mật khẩu.');

    setBusy(true);
    try {
      if (mode === 'register') {
        const existing = await loadAccount(name);
        if (existing) return setError('Tên đăng nhập đã tồn tại.');

        const key = privateKey.trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(key)) {
          return setError('Khoá riêng phải đúng 64 ký tự hex (0-9, a-f).');
        }
        if (!(await isValidPrivateKey(key))) {
          return setError('Khoá riêng không nằm trong miền hợp lệ của secp256k1.');
        }

        const identity = await deriveIdentity(key);
        const vault = await encryptPrivateKey(key, password);
        await saveAccount(name, {
          username: name,
          publicKey: identity.publicKey,
          address: identity.address,
          salt: vault.salt,
          ciphertext: vault.ciphertext,
        });
        onLogin({ username: name, ...identity });
      } else {
        const account = await loadAccount(name);
        if (!account) return setError('Không tìm thấy tài khoản này.');

        const key = await decryptPrivateKey(account.ciphertext, account.salt, password);
        // Sai mật khẩu thì XOR ra rác: khoá có thể vô hiệu, hoặc dẫn ra địa chỉ khác.
        if (!(await isValidPrivateKey(key))) return setError('Sai mật khẩu.');
        const identity = await deriveIdentity(key);
        if (identity.address !== account.address) return setError('Sai mật khẩu.');

        onLogin({ username: name, ...identity });
      }
    } catch (e) {
      setError('Lỗi: ' + String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Ví Blockchain</Text>
        <Text style={styles.subtitle}>Ký số ECDSA secp256k1</Text>

        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, mode === 'login' && styles.tabActive]}
            onPress={() => reset('login')}
          >
            <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Đăng nhập</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, mode === 'register' && styles.tabActive]}
            onPress={() => reset('register')}
          >
            <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>
              Tạo tài khoản
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Tên đăng nhập</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="vi-a"
            placeholderTextColor="#4B5563"
          />

          <Text style={styles.label}>Mật khẩu</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            placeholder="••••••"
            placeholderTextColor="#4B5563"
          />

          {mode === 'register' ? (
            <>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Khoá riêng (64 ký tự hex)</Text>
                <Pressable onPress={genKey} hitSlop={8}>
                  <Text style={styles.link}>Sinh ngẫu nhiên</Text>
                </Pressable>
              </View>
              <TextInput
                style={[styles.input, styles.mono]}
                value={privateKey}
                onChangeText={setPrivateKey}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                placeholder="nhập hoặc bấm Sinh ngẫu nhiên"
                placeholderTextColor="#4B5563"
              />
              <Text style={styles.hint}>
                Khoá riêng được mã hoá bằng mật khẩu trước khi lưu, không lưu ở dạng trần.
              </Text>
            </>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.button} onPress={submit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#08130C" />
            ) : (
              <Text style={styles.buttonText}>
                {mode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập'}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F1115' },
  scroll: { padding: 20, paddingTop: 72, gap: 16 },
  title: { color: '#E5E7EB', fontSize: 30, fontWeight: '800' },
  subtitle: { color: '#9CA3AF', fontSize: 14, marginTop: -10 },
  tabs: { flexDirection: 'row', backgroundColor: '#1A1D24', borderRadius: 16, padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 16, alignItems: 'center' },
  tabActive: { backgroundColor: 'rgba(34,197,94,0.16)' },
  tabText: { color: '#9CA3AF', fontWeight: '700', fontSize: 14 },
  tabTextActive: { color: '#22C55E' },
  card: { backgroundColor: '#1A1D24', borderRadius: 16, padding: 16, gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', marginTop: 6 },
  link: { color: '#22C55E', fontSize: 12, fontWeight: '700', marginTop: 6 },
  input: {
    backgroundColor: '#0B0D11',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#22262F',
    color: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  mono: { fontFamily: MONO, fontSize: 12, minHeight: 62 },
  hint: { color: '#6B7280', fontSize: 11, lineHeight: 16 },
  error: { color: '#EF4444', fontSize: 13, fontWeight: '600', marginTop: 4 },
  button: {
    backgroundColor: '#22C55E',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: { color: '#08130C', fontWeight: '800', fontSize: 16 },
});
