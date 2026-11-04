import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useT } from '@/i18n';

const icon = (glyph: string) => function TabIcon({ color }: { color: unknown }) {
  return <Text style={{ color: color as string, fontSize: 18 }}>{glyph}</Text>;
};

export default function TabsLayout() {
  const t = useT();
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: t('nav.dashboard'), tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="proposals" options={{ title: t('nav.proposals'), tabBarIcon: icon('✎') }} />
      <Tabs.Screen name="users" options={{ title: t('nav.users'), tabBarIcon: icon('☺') }} />
      <Tabs.Screen name="settings" options={{ title: t('nav.settings'), tabBarLabel: t('settings.pushPermission'), tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
