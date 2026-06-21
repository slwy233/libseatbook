import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, ActivityIndicator } from 'react-native';
import { getToken } from './src/utils/storage';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import RoomListScreen from './src/screens/RoomListScreen';
import SeatMapScreen from './src/screens/SeatMapScreen';
import MyReservationsScreen from './src/screens/MyReservationsScreen';
import ScheduledScreen from './src/screens/ScheduledScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Tab 图标 (纯文字 fallback)
function TabIcon({ emoji, focused }) {
  return (
    <Text style={{ fontSize: focused ? 24 : 20, opacity: focused ? 1 : 0.5 }}>
      {emoji}
    </Text>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1677FF',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: '#f0f0f0',
          paddingTop: 6,
          paddingBottom: 8,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: '首页',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Scheduled"
        component={ScheduledScreen}
        options={{
          tabBarLabel: '定时预约',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⏰" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Reservations"
        component={MyReservationsScreen}
        options={{
          tabBarLabel: '我的预约',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkLogin();
  }, []);

  const checkLogin = async () => {
    try {
      const token = await getToken();
      if (token) {
        setInitialRoute('Main');
      } else {
        setInitialRoute('Login');
      }
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
        <Text style={{ color: '#fff', marginTop: 16, fontSize: 16 }}>加载中...</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen
          name="RoomList"
          component={RoomListScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="SeatMap"
          component={SeatMapScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
