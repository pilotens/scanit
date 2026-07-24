import { Tabs } from 'expo-router';

import { colors } from '@/constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 70,
          paddingTop: 8,
          paddingBottom: 10,
        },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Översikt' }} />
      <Tabs.Screen name="scanner" options={{ title: 'Scanner' }} />
      <Tabs.Screen name="history" options={{ title: 'Historik' }} />
      <Tabs.Screen name="sensors" options={{ title: 'Sensorer' }} />
      <Tabs.Screen name="settings" options={{ title: 'Inställningar' }} />
    </Tabs>
  );
}
