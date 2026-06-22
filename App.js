import React, { useEffect, useState, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, ActivityIndicator, Alert } from 'react-native';
import { getToken } from './src/utils/storage';
import { onTokenExpired } from './src/utils/authManager';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import BuildingListScreen from './src/screens/BuildingListScreen';
import RoomListScreen from './src/screens/RoomListScreen';
import SeatMapScreen from './src/screens/SeatMapScreen';
import MyReservationsScreen from './src/screens/MyReservationsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ emoji, focused }) {
  return <Text style={{ fontSize: focused ? 22 : 18, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1677FF',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: { borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 6, paddingBottom: 8, height: 60 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen}
        options={{ tabBarLabel: '首页', tabBarIcon: ({focused}) => <TabIcon emoji="🏠" focused={focused}/> }} />
      <Tab.Screen name="Book" component={BuildingListScreen}
        options={{ tabBarLabel: '预约选座', tabBarIcon: ({focused}) => <TabIcon emoji="🪑" focused={focused}/> }} />
      <Tab.Screen name="My" component={MyReservationsScreen}
        options={{ tabBarLabel: '我的', tabBarIcon: ({focused}) => <TabIcon emoji="📋" focused={focused}/> }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigationRef = useRef(null);

  useEffect(() => {
    // 设置token过期回调
    onTokenExpired((needManual) => {
      setTimeout(() => {
        if (navigationRef.current) {
          Alert.alert(
            '登录已过期',
            needManual
              ? '自动重登失败，请手动输入验证码重新登录'
              : '登录状态已过期，请重新登录',
            [{
              text: '重新登录',
              onPress: () => {
                navigationRef.current.reset({
                  index: 0,
                  routes: [{ name: 'Login', params: { forceReLogin: true } }],
                });
              },
            }]
          );
        }
      }, 300);
    });
  }, []);

  useEffect(() => { checkLogin(); }, []);

  const checkLogin = async () => {
    try {
      const token = await getToken();
      setInitialRoute(token ? 'Main' : 'Login');
    } catch (e) {
      setInitialRoute('Login');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1677FF' }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <StatusBar style="light" />
      <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="RoomList" component={RoomListScreen} />
        <Stack.Screen name="SeatMap" component={SeatMapScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
