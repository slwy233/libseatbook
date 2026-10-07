import React, { useEffect, useState, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getToken } from './src/utils/storage';
import { onTokenExpired, setGlobalNavRef } from './src/utils/authManager';
import { colors } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import BuildingListScreen from './src/screens/BuildingListScreen';
import RoomListScreen from './src/screens/RoomListScreen';
import SeatMapScreen from './src/screens/SeatMapScreen';
import MyReservationsScreen from './src/screens/MyReservationsScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const icons = { Home: '⌂', Book: '▦', Schedule: '◷', My: '☰' };
function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerShown: false, tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { borderTopColor: colors.border, height: 64 + insets.bottom, paddingTop: 6, paddingBottom: insets.bottom + 6 },
      tabBarLabelStyle: { fontSize: 12 },
      tabBarIcon: ({ color }) => <Text style={{ fontSize: 26, color }}>{icons[route.name]}</Text>,
    })}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: '首页' }} />
      <Tab.Screen name="Book" component={BuildingListScreen} options={{ tabBarLabel: '选座' }} />
      <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ tabBarLabel: '定时' }} />
      <Tab.Screen name="My" component={MyReservationsScreen} options={{ tabBarLabel: '我的预约' }} />
    </Tab.Navigator>
  );
}
export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const navigationRef = useRef(null);
  useEffect(() => {
    let active = true;
    setGlobalNavRef(navigationRef);
    const unsubscribe = onTokenExpired(needManual => Alert.alert(
      '需要重新登录', needManual ? '自动登录未完成，请输入验证码重新登录。' : '登录状态已过期，请重新登录。',
      [{ text: '好的' }],
    ));
    getToken().then(token => { if (active) setInitialRoute(token ? 'Main' : 'Login'); })
      .catch(() => { if (active) setInitialRoute('Login'); });
    return () => { active = false; unsubscribe?.(); setGlobalNavRef(null); };
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {initialRoute ? <NavigationContainer ref={navigationRef} onReady={() => setGlobalNavRef(navigationRef)}>
        <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="RoomList" component={RoomListScreen} />
          <Stack.Screen name="SeatMap" component={SeatMapScreen} />
        </Stack.Navigator>
      </NavigationContainer> : <View style={{ flex: 1, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color="#fff" size="large" /></View>}
    </SafeAreaProvider>
  );
}

