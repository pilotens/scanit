import type {
  TomographyAcquisitionConfiguration,
  TomographyScannerProvider,
} from './provider';
import { reconstructTomography } from './reconstruction';
import { tomographyCaptureRepository } from './tomographyRepository';

export class TomographyLabRunner {
  async captureBackground(input: {
    provider: TomographyScannerProvider;
    configuration: TomographyAcquisitionConfiguration;
    captureId: string;
  }) {
    const { provider, configuration, captureId } = input;
    await provider.connect();
    try {
      await provider.configure(configuration);
      const capture = await provider.capture({
        id: captureId,
        calibrationRole: 'background',
      });
      const manifest = await tomographyCaptureRepository.save(capture);
      return { manifest, capture };
    } finally {
      await provider.disconnect();
    }
  }

  async captureSubjectAndReconstruct(input: {
    provider: TomographyScannerProvider;
    configuration: TomographyAcquisitionConfiguration;
    captureId: string;
    backgroundCaptureId: string;
  }) {
    const {
      provider,
      configuration,
      captureId,
      backgroundCaptureId,
    } = input;
    const background = await tomographyCaptureRepository.load(
      backgroundCaptureId,
    );
    await provider.connect();
    try {
      await provider.configure(configuration);
      const subject = await provider.capture({
        id: captureId,
        calibrationRole: 'subject',
        referenceCaptureId: backgroundCaptureId,
      });
      const subjectManifest = await tomographyCaptureRepository.save(subject);
      const verifiedSubject = await tomographyCaptureRepository.load(
        subjectManifest.id,
      );
      const reconstruction = reconstructTomography({
        subject: verifiedSubject,
        background,
      });
      return {
        subjectManifest,
        background,
        subject: verifiedSubject,
        reconstruction,
      };
    } finally {
      await provider.disconnect();
    }
  }
}
