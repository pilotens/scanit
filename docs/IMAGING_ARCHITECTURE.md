# ScanIt multimodal imaging architecture

## Objective

Build a research platform that can ingest spatially tracked measurements from complementary sensors and reconstruct a subject-specific volume. The software must never convert an anatomical prior into a claim that the anatomy was measured.

## Modalities

1. **Ultrasound** — primary structural channel where acoustic windows exist.
2. **Microwave imaging** — dielectric-contrast channel for experimental inverse-scattering reconstruction.
3. **UWB/mmWave** — dynamic displacement/timing channel, not assumed to provide organ anatomy.
4. **Camera + IMU** — sensor pose and sweep registration.

## Data flow

```text
sensor -> calibration -> timestamp/pose registration -> modality preprocessing
       -> common coordinate system -> reconstruction -> confidence/provenance
       -> segmentation (future) -> visualization
```

## Non-negotiable provenance model

Every reconstructed element is tagged as:

- `measured`: directly supported by acquired sensor evidence.
- `inferred`: produced by a model/prior and clearly distinguishable from measurement.
- `unknown`: insufficient evidence.

AI-generated anatomy must never silently replace unknown regions.

## Current implementation

`src/domain/imaging.ts` defines the modality-neutral measurement and voxel contracts.

`src/services/reconstruction/reconstructionEngine.ts` is a transparent evidence-grid baseline. It is intentionally simple: its job is to establish the software interfaces and validation harness before implementing ultrasound beamforming, microwave inverse scattering, sensor fusion, or learned reconstruction.

`src/services/sensors/mockImagingScanner.ts` generates a deterministic synthetic chest sweep so development can continue without experimental hardware.

## Planned reconstruction stack

- ultrasound: RF acquisition -> filtering -> delay-and-sum/plane-wave beamforming -> B-mode volume
- microwave: calibrated complex S-parameters -> background subtraction -> inverse scattering -> dielectric volume
- motion: clutter removal -> range/Doppler/phase processing -> displacement field
- fusion: rigid/non-rigid registration -> uncertainty-aware evidence fusion
- AI: segmentation and physics-informed reconstruction with explicit provenance

## Validation

The first physical benchmark is not a human diagnostic study. It is a phantom with known geometry and hidden targets. Metrics should include localization error, structural overlap, contrast recovery, repeatability, calibration drift, and false-positive volume.

This repository is a research prototype and is not a medical device or diagnostic system.
