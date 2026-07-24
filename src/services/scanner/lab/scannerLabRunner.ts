import type { RawRadioFrame } from '@/domain/radio';
import type {
  ScannerLabCaptureOptions,
  ScannerLabCaptureResult,
  ScannerLabProgress,
} from '@/domain/scannerLab';

import { generateSyntheticRadioFrame } from '../emulator/syntheticScanner';
import { ScannerGatewayClient } from '../gateway/scannerGatewayClient';
import { defaultGatewayFmcwConfiguration } from '../gateway/types';
import { scannerRecordingRepository } from '../recording/recordingRepository';
import { replayScannerRecording } from '../replay/replayEngine';
import { scannerRuntime } from '../runtime/scannerRuntime';

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const progress = (
  callback: ((event: ScannerLabProgress) => void) | undefined,
  event: ScannerLabProgress,
) => callback?.(event);

export class ScannerLabRunner {
  async capture(
    options: ScannerLabCaptureOptions,
    onProgress?: (event: ScannerLabProgress) => void,
  ): Promise<ScannerLabCaptureResult> {
    const durationSeconds = clamp(options.durationSeconds, 1, 60);
    const targetFrameRateHz = clamp(options.targetFrameRateHz, 1, 30);
    const targetFrames = Math.max(
      8,
      Math.min(clamp(options.maxFrames, 8, 1200), Math.round(durationSeconds * targetFrameRateHz)),
    );
    const calibrationFrames = Math.max(
      4,
      Math.min(options.calibrationFrames, targetFrames - 2),
    );
    const runtime = scannerRuntime.getState();

    progress(onProgress, {
      phase: 'connecting',
      progress: 0.02,
      message: runtime.mode === 'gateway' ? 'Ansluter till fysisk scanner.' : 'Startar scanneremulatorn.',
      framesCaptured: 0,
      targetFrames,
    });

    let frames: RawRadioFrame[];
    let sourceDescriptor: string;
    let hardwareProfileId: string;

    if (runtime.mode === 'gateway') {
      const client = new ScannerGatewayClient(runtime.url);
      try {
        await client.connect();
        progress(onProgress, {
          phase: 'configuring',
          progress: 0.06,
          message: 'Konfigurerar FMCW-svep och hårdvarukalibrering.',
          framesCaptured: 0,
          targetFrames,
        });
        await client.configure({
          ...defaultGatewayFmcwConfiguration,
          frameRateHz: targetFrameRateHz,
        });
        await client.calibrate();
        const sessionId = `lab-${Date.now()}-${options.position}`;
        await client.startStream(sessionId, options.position);
        frames = [];
        const deadline = Date.now() + durationSeconds * 1000 + 5_000;
        try {
          while (frames.length < targetFrames && Date.now() < deadline) {
            try {
              frames.push(await client.nextFrame(3_000));
              progress(onProgress, {
                phase: 'capturing',
                progress: 0.08 + (frames.length / targetFrames) * 0.72,
                message: `Tar emot fysisk rådata (${frames.length}/${targetFrames}).`,
                framesCaptured: frames.length,
                targetFrames,
              });
            } catch (error) {
              if (frames.length >= calibrationFrames + 4) break;
              throw error;
            }
          }
        } finally {
          await client.stopStream().catch(() => undefined);
        }
      } finally {
        client.disconnect();
      }
      sourceDescriptor = runtime.url;
      hardwareProfileId = 'infineon-bgt60tr13c';
    } else {
      const sessionId = `lab-emulator-${Date.now()}-${options.position}`;
      const startTimestampNs = BigInt(Date.now()) * 1_000_000n;
      const frameIntervalNs = BigInt(Math.round(1_000_000_000 / targetFrameRateHz));
      frames = [];
      for (let sequence = 0; sequence < targetFrames; sequence += 1) {
        const frame = generateSyntheticRadioFrame({
          sessionId,
          sequence,
          position: options.position,
          elapsedSeconds: sequence / targetFrameRateHz,
          motionScale: sequence < calibrationFrames ? 0 : 1,
        });
        frame.timestampNs = String(startTimestampNs + BigInt(sequence) * frameIntervalNs);
        frames.push(frame);
        if (sequence % 12 === 0 || sequence === targetFrames - 1) {
          progress(onProgress, {
            phase: 'capturing',
            progress: 0.08 + ((sequence + 1) / targetFrames) * 0.72,
            message: `Genererar reproducerbara testframes (${sequence + 1}/${targetFrames}).`,
            framesCaptured: sequence + 1,
            targetFrames,
          });
          await Promise.resolve();
        }
      }
      sourceDescriptor = 'deterministic-body-emulator-v1';
      hardwareProfileId = 'infineon-bgt60tr13c-emulator';
    }

    if (frames.length < calibrationFrames + 2) {
      throw new Error(`För få frames registrerades (${frames.length}).`);
    }

    progress(onProgress, {
      phase: 'saving',
      progress: 0.84,
      message: 'Krypterar och sparar råframes i chunkar.',
      framesCaptured: frames.length,
      targetFrames,
    });
    const manifest = await scannerRecordingRepository.save({
      frames,
      label: options.label,
      source: runtime.mode,
      sourceDescriptor,
      hardwareProfileId,
      calibrationFrameCount: calibrationFrames,
      tags: options.tags,
      notes: options.notes,
    });

    progress(onProgress, {
      phase: 'replaying',
      progress: 0.92,
      message: 'Återspelar inspelningen genom scanner-pipeline v1.',
      framesCaptured: frames.length,
      targetFrames,
    });
    const recording = await scannerRecordingRepository.load(manifest.id);
    const replay = replayScannerRecording(recording);

    progress(onProgress, {
      phase: 'completed',
      progress: 1,
      message: 'Inspelning och verifierad replay är klara.',
      framesCaptured: frames.length,
      targetFrames,
    });
    return { manifest, replay };
  }
}
