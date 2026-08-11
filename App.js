// Phải nằm trước mọi import khác: noble cần crypto.getRandomValues, React Native không có sẵn.
import 'react-native-get-random-values';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startNode } from './src/node/runtime';
import AuthScreen from './src/screens/AuthScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import WalletScreen from './src/screens/WalletScreen';
import { ensureSchema, mirrorSnapshot } from './src/storage/persist';

const Tab = createBottomTabNavigator();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0F1115',
    card: '#1A1D24',
    text: '#E5E7EB',
    border: '#1A1D24',
    primary: '#22C55E',
  },
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);

  useEffect(() => {
    ensureSchema()
      .then(() => mirrorSnapshot())
      .finally(() => setReady(true));
  }, []);

  // Node là của MÁY, không của màn hình: bật lên khi có danh tính rồi cứ chạy tiếp,
  // đăng xuất cũng không tắt vì chain và việc đào không phụ thuộc vào ai đang đăng nhập.
  useEffect(() => {
    if (session) startNode(session);
  }, [session]);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
        <ActivityIndicator color="#22C55E" size="large" />
      </View>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthScreen onLogin={setSession} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#0F1115' },
            headerTitleStyle: { color: '#E5E7EB' },
            headerShadowVisible: false,
            tabBarStyle: { backgroundColor: '#1A1D24', borderTopColor: '#1A1D24' },
            tabBarActiveTintColor: '#22C55E',
            tabBarInactiveTintColor: '#6B7280',
          }}
        >
          <Tab.Screen name="Ví" options={{ headerShown: false }}>
            {() => (
              // Đăng xuất xoá khoá riêng khỏi state, không giữ lại trong bộ nhớ.
              <WalletScreen session={session} onLogout={() => setSession(null)} />
            )}
          </Tab.Screen>
          <Tab.Screen name="Sổ cái" options={{ title: 'Sổ cái của node này' }}>
            {() => <LedgerScreen session={session} />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = {
  loading: {
    flex: 1,
    backgroundColor: '#0F1115',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
