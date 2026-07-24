# ScanIt

ScanIt is an early mobile research platform for combining continuous wearable measurements with a guided, extended RF scan.

The current repository contains a runnable **Expo/React Native prototype** and a scanner research stack. It does not diagnose, predict, or exclude myocardial infarction or any other medical condition.

## Current mobile scope

- Swedish dashboard for wearable vitals and personal baseline
- Guided extended scan workflow
- Modular interfaces for wearable and RF sensor providers
- Scanner Lab with encrypted raw record/replay
- Deterministic RF signal-quality gate
- Multi-bin respiratory and mechanical-cardiac band analysis
- Position-, modality-, and hardware-specific personal RF baselines
- Physical BGT60TR13C gateway path plus deterministic scanner emulator
- Scan history, sensor inventory, research settings, and safety wording

## Technology

- Expo SDK 57
- React Native 0.86
- React 19.2
- TypeScript
- Expo Router
- Python gateway for Infineon RDK
- ESP32-S3 transport reference firmware

## Run locally

```bash
npm install
npm run start
```

Then open the project in Expo Go, an emulator, or the web target. Native hardware integrations require an Expo development build.

## Validation

```bash
npm test
npm run typecheck
npm run lint
```

## Important boundaries

- RF visualizations represent relative signal response, not verified anatomy.
- Periodic RF bands are research signals and are not medical heart-rate or breathing diagnoses.
- Only technically approved measurements may enter a personal RF baseline.
- The LLM layer is not implemented as a raw biosignal classifier.
- Future medical claims require clinical validation and regulatory assessment.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Scanner architecture](docs/SCANNER_ARCHITECTURE.md)
- [Scanner signal quality](docs/SCANNER_SIGNAL_QUALITY.md)
- [Physical scanner adapter](docs/SCANNER_PHYSICAL_ADAPTER.md)
- [Scanner PoC](docs/SCANNER_POC.md)
- [Data model](docs/DATA_MODEL.md)
- [Roadmap](docs/ROADMAP.md)
