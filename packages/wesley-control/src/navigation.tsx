import React from 'react';
import { Text, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from './screens/HomeScreen';
import { StoresScreen } from './screens/StoresScreen';
import { StoreDetailScreen } from './screens/StoreDetailScreen';
import { AlertsScreen, AlertsStoreScreen } from './screens/AlertsScreen';
import { CompareScreen } from './screens/CompareScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { themeFor } from './theme';
import type { AlertsStackParams, StoresStackParams } from './navigation-types';

const Tabs = createBottomTabNavigator();
const StoresStack = createNativeStackNavigator<StoresStackParams>();
const AlertsStack = createNativeStackNavigator<AlertsStackParams>();

function StoresNavigator() {
  return (
    <StoresStack.Navigator>
      <StoresStack.Screen
        name="StoresList"
        component={StoresScreen}
        options={{ title: 'Magasins' }}
      />
      <StoresStack.Screen
        name="StoreDetail"
        component={StoreDetailScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
    </StoresStack.Navigator>
  );
}

function AlertsNavigator() {
  return (
    <AlertsStack.Navigator>
      <AlertsStack.Screen
        name="AlertsHome"
        component={AlertsScreen}
        options={{ title: 'Alertes' }}
      />
      <AlertsStack.Screen
        name="AlertsStore"
        component={AlertsStoreScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
    </AlertsStack.Navigator>
  );
}

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
}

export function RootNavigation() {
  const scheme = useColorScheme();
  const theme = themeFor(scheme);
  const navTheme = scheme === 'light' ? DefaultTheme : DarkTheme;

  return (
    <NavigationContainer
      theme={{
        ...navTheme,
        colors: {
          ...navTheme.colors,
          background: theme.bg,
          card: theme.card,
          text: theme.text,
          primary: theme.accent,
          border: theme.cardBorder,
        },
      }}
    >
      <Tabs.Navigator
        screenOptions={{
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.muted,
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Tabs.Screen
          name="Accueil"
          component={HomeScreen}
          options={{
            title: 'Réseau',
            tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} />,
          }}
        />
        <Tabs.Screen
          name="Magasins"
          component={StoresNavigator}
          options={{
            headerShown: false,
            tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} />,
          }}
        />
        <Tabs.Screen
          name="Alertes"
          component={AlertsNavigator}
          options={{
            headerShown: false,
            tabBarIcon: ({ color }) => <TabIcon glyph="!" color={color} />,
          }}
        />
        <Tabs.Screen
          name="Comparer"
          component={CompareScreen}
          options={{
            tabBarIcon: ({ color }) => <TabIcon glyph="⇄" color={color} />,
          }}
        />
        <Tabs.Screen
          name="Réglages"
          component={SettingsScreen}
          options={{
            tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} />,
          }}
        />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
