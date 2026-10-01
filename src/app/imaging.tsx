import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { VolumeSlice } from '@/components/VolumeSlice';
import { colors, spacing } from '@/constants/theme';
import type { ReconstructionVolume } from '@/domain/imaging';
import { reconstructVolume } from '@/services/reconstruction/reconstructionEngine';
import { createSimulatedChestSweep } from '@/services/sensors/mockImagingScanner';

export default function ImagingLabScreen() {
  const [volume, setVolume] = useState<ReconstructionVolume | null>(null);
  const [running, setRunning] = useState(false);
  const { width } = useWindowDimensions();
  const previewWidth = Math.min(360, Math.max(250, width - 64));

  const stats = useMemo(() => {
    if (!volume) return null;
    const multimodal = volume.voxels.filter((v) => v.modalities.length > 1).length;
    const confidence =
      volume.voxels.reduce((sum, voxel) => sum + voxel.confidence, 0) /
      Math.max(1, volume.voxels.length);
    return { multimodal, confidence };
  }, [volume]);

  const run = async () => {
    setRunning(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const measurements = createSimulatedChestSweep();
    setVolume(reconstructVolume({ measurements, voxelSizeMm: 5 }));
    setRunning(false);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text onPress={() => router.back()} style={styles.back}>‹ Tillbaka</Text>
        <Text style={styles.title}>Imaging Lab</Text>
        <Text style={styles.subtitle}>Multimodal rekonstruktion · forsknings-MVP</Text>
      </View>

      <Card muted>
        <Text style={styles.noticeTitle}>SIMULERAD MÄTNING</Text>
        <Text style={styles.body}>
          Den här MVP:n verifierar datakedjan och rekonstruktionen. Den visar inte uppmätt mänsklig anatomi.
        </Text>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Bröstkorgssvep</Text>
        <Text style={styles.body}>
          Genererar synkroniserade ultrasound-, microwave- och UWB-observationer med känd sensorposition.
        </Text>
        <AppButton label={running ? 'Rekonstruerar…' : 'Kör simulerad skanning'} onPress={run} disabled={running} />
      </Card>

      {volume ? (
        <>
          <Card>
            <Text style={styles.cardTitle}>Rekonstruerad evidensvolym</Text>
            <Text style={styles.body}>
              Varje punkt representerar sensorstödd evidens. Ingen anatomisk AI-prior används i denna vy.
            </Text>
            <VolumeSlice volume={volume} width={previewWidth} height={230} />
          </Card>

          <View style={styles.metrics}>
            <Card style={styles.metric}>
              <Text style={styles.metricValue}>{volume.voxels.length}</Text>
              <Text style={styles.metricLabel}>voxlar</Text>
            </Card>
            <Card style={styles.metric}>
              <Text style={styles.metricValue}>{Math.round((stats?.confidence ?? 0) * 100)}%</Text>
              <Text style={styles.metricLabel}>medel-confidence</Text>
            </Card>
            <Card style={styles.metric}>
              <Text style={styles.metricValue}>{stats?.multimodal ?? 0}</Text>
              <Text style={styles.metricLabel}>multimodala voxlar</Text>
            </Card>
          </View>

          <Card>
            <Text style={styles.cardTitle}>Provenance</Text>
            <Text style={styles.body}>Measured: {volume.voxels.filter((v) => v.provenance === 'measured').length}</Text>
            <Text style={styles.body}>Inferred: {volume.voxels.filter((v) => v.provenance === 'inferred').length}</Text>
            <Text style={styles.body}>Unknown regions are intentionally not filled in.</Text>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingTop: 56, gap: spacing.lg, paddingBottom: 48 },
  header: { gap: spacing.xs },
  back: { color: colors.primary, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  title: { color: colors.ink, fontSize: 30, fontWeight: '800' },
  subtitle: { color: colors.inkMuted, fontSize: 14 },
  noticeTitle: { color: colors.elevated, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  body: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flex: 1, minWidth: 100, alignItems: 'center' },
  metricValue: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  metricLabel: { color: colors.inkMuted, fontSize: 11, textAlign: 'center' },
});
