import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

type SectionHeaderProps = {
  title: string;
  detail?: string;
};

export function SectionHeader({ title, detail }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  detail: { color: colors.inkMuted, fontSize: 12 },
});
