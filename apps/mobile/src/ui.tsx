import type { Light as LightLevel } from '@varsling/shared';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps, type ViewStyle } from 'react-native';
import { useT } from './i18n';

export const palette = {
  light: { bg: '#f6f7f9', surface: '#ffffff', text: '#17202a', muted: '#5b6673', border: '#dde2e8', primary: '#1d4ed8', danger: '#b42318' },
  dark: { bg: '#0f1418', surface: '#182027', text: '#e8edf2', muted: '#9aa6b2', border: '#2b3640', primary: '#5b8cff', danger: '#ff6b5e' },
};
export function useColors() {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

const LIGHT_COLOR: Record<LightLevel, string> = { none: '#ffffff', green: '#2e9e4f', yellow: '#f2c200', red: '#d92d20' };
const LIGHT_ICON: Record<LightLevel, string> = { none: '○', green: '◔', yellow: '!', red: '‼' };

/** Never colour alone: icon and text label too (accessibility). */
export function Light({ level, compact }: { level: LightLevel; compact?: boolean }) {
  const t = useT();
  const c = useColors();
  return (
    <View style={styles.row} accessible accessibilityLabel={t(`light.${level}`)}>
      <View style={[styles.dot, { backgroundColor: LIGHT_COLOR[level], borderColor: c.border }]}>
        <Text style={{ color: level === 'red' || level === 'green' ? '#fff' : '#111', fontWeight: '700' }}>{LIGHT_ICON[level]}</Text>
      </View>
      <Text style={{ color: c.text, fontWeight: '600' }}>{compact ? t(`level.${level}`) : t(`light.${level}`)}</Text>
    </View>
  );
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = useColors();
  const body = <View style={{ padding: 16, gap: 12 }}>{children}</View>;
  return scroll ? <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 32 }}>{body}</ScrollView> : <View style={{ flex: 1, backgroundColor: c.bg }}>{body}</View>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 14, gap: 8 }, style]}>{children}</View>;
}

export function T({ children, muted, bold, size, color }: { children: ReactNode; muted?: boolean; bold?: boolean; size?: number; color?: string }) {
  const c = useColors();
  return <Text style={{ color: color ?? (muted ? c.muted : c.text), fontWeight: bold ? '700' : '400', fontSize: size ?? 16 }}>{children}</Text>;
}

export function Button({ title, onPress, kind = 'default', disabled, testID }: { title: string; onPress: () => void; kind?: 'default' | 'primary' | 'danger'; disabled?: boolean; testID?: string }) {
  const c = useColors();
  const bg = kind === 'primary' ? c.primary : c.surface;
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? c.danger : c.text;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: bg, borderColor: kind === 'danger' ? c.danger : kind === 'primary' ? c.primary : c.border, borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, opacity: disabled ? 0.4 : pressed ? 0.7 : 1, alignItems: 'center' }]}>
      <Text style={{ color: fg, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.text, fontWeight: '500' }}>{props.label}</Text>
      <TextInput placeholderTextColor={c.muted} {...props} style={[{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, color: c.text, backgroundColor: c.surface }, props.style]} />
    </View>
  );
}

export function Loading() {
  return <View style={{ padding: 32 }}><ActivityIndicator /></View>;
}

export function Banner({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'info' }) {
  return (
    <View style={{ backgroundColor: tone === 'warn' ? '#fff4e5' : '#eaf1ff', borderColor: tone === 'warn' ? '#f5c27a' : '#b9cdfa', borderWidth: 1, borderRadius: 8, padding: 10 }}>
      <Text style={{ color: tone === 'warn' ? '#7a4100' : '#123a8a' }}>{children}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress}
      style={{ borderWidth: 1, borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primary : c.surface, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
      <Text style={{ color: selected ? '#fff' : c.text }}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
