# ScanIt

ScanIt is an early mobile research platform for wearable measurements, contactless RF motion sensing and experimental multistatic microwave tomography.

The repository contains a runnable **Expo/React Native prototype** and two strictly separated scanner research stacks. It does not diagnose, predict or exclude myocardial infarction or any other medical condition.

## Scanner tracks

### Track A — vital motion sensing

- full BGT60TR13C RX × chirp × ADC acquisition;
- RX gain/phase calibration;
- monotonic timing and quantified clock uncertainty;
- range, phase, chirp/RX coherence and target tracking;
- respiratory and mechanical-cardiac periodicity research;
- explicit ECG R-peak / PPG pulse event-locked averaging;
- encrypted record/replay and personal RF baseline;
- Wi-Fi CSI and UWB comparison sources.

### Track B — multistatic microwave tomography

- dedicated 12–16 port coherent-array research model;
- antenna geometry and field-of-view definition;
- complex S21 measurements for each TX/RX/frequency path;
- background calibration and exact differential subtraction;
- tomography-specific quality gate;
- coherent first-order backprojection;
- relative scattering-contrast maps;
- deterministic phantom simulator and end-to-end diagnostic;
- hardware-provider contract for a future physical array.

Track B requires special coherent microwave hardware. It is not ordinary phone or router Wi-Fi.

## Current mobile scope

- Swedish dashboard for wearable vitals and personal baseline
- Guided extended scan workflow
- Modular wearable, vital-scanner and tomography-provider interfaces
- Scanner Lab with encrypted raw record/replay
- Separate vital-motion and tomography research modes
- Deterministic signal-quality and reconstruction-quality gates
- Physical BGT60TR13C gateway path plus deterministic scanner emulator
- Multistatic phantom simulation and contrast reconstruction
- Scan history, sensor inventory, research settings and safety wording

## Technology

- Expo SDK 57
- React Native 0.86
- React 19.2
- TypeScript
- Expo Router
- Python gateway for Infineon RDK
- ESP32-S3 transport reference firmware
- Complex S21 tomography research pipeline

## Run locally

```bash
npm install
npm run start
```

Then open the project in Expo Go, an emulator or the web target. Native hardware integrations require an Expo development build.

## Validation

```bash
npm test
npm run typecheck
npm run lint
```

## Important boundaries

- RF motion signals represent range, phase and mechanical response, not verified anatomy.
- Tomography output is differential scattering contrast, not a validated anatomical image.
- Periodic RF bands are research signals, not medical heart-rate or breathing diagnoses.
- Ordinary Wi-Fi CSI cannot image the heart, blood flow or coronary arteries.
- The current tomography inverse model cannot identify coronary vessels, stenosis, ischemia or infarction.
- Only technically approved measurements may enter a personal RF baseline.
- The LLM layer is not implemented as a raw biosignal classifier.
- Future medical claims require phantom studies, independent reference imaging, clinical validation and regulatory assessment.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Scanner architecture](docs/SCANNER_ARCHITECTURE.md)
- [Dual-track scanner architecture](docs/SCANNER_DUAL_TRACK_ARCHITECTURE.md)
- [Scanner signal quality](docs/SCANNER_SIGNAL_QUALITY.md)
- [Physical scanner adapter](docs/SCANNER_PHYSICAL_ADAPTER.md)
- [Scanner PoC](docs/SCANNER_POC.md)
- [Data model](docs/DATA_MODEL.md)
- [Roadmap](docs/ROADMAP.md)
