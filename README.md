# ScanIt

ScanIt is an early mobile research platform for combining wearable measurements with a guided, extended RF scan.

The repository contains an **Expo/React Native research prototype**. It does not diagnose, predict, or exclude myocardial infarction or any other medical condition.

## Current mobile scope

- Swedish dashboard for wearable vitals and personal baseline
- Informed onboarding, local profile and versioned consent
- Read-only Apple Health import on signed iOS builds
- Pulse, SDNN HRV, SpO₂, sleeping wrist temperature and ECG summaries
- AES-256-GCM encrypted native persistence with an OS-protected key
- Guided extended scan workflow
- Modular interfaces for wearable and RF sensor providers
- Simulated RF observations and prototype risk fusion
- Scan history, sensor inventory, settings and explicit safety wording
- Domain models for future Wi-Fi CSI, Bluetooth Channel Sounding, UWB and 60 GHz adapters

## Technology

- Expo SDK 57
- React Native 0.86
- React 19.2
- TypeScript
- Expo Router
- Local Expo Modules API integration for HealthKit

## Run the portable prototype

```bash
npm install
npm run start
```

Web, Android and Expo Go use safe fallbacks and cannot access HealthKit.

## Generate the native iOS project

```bash
npm install
npm run prebuild:ios
```

HealthKit requires a signed iOS development or production build with the HealthKit capability. The Swift bridge must be tested on a physical iPhone containing Apple Health data.

## Validation

```bash
npm run typecheck
npm run lint
npx expo export --platform web
npx expo prebuild --platform ios --no-install --clean
```

## Important boundaries

- Apple Health values are imported summaries, not synchronized raw Apple Watch signals.
- Missing HealthKit values stay missing; they are never filled with synthetic normal values.
- HealthKit HRV is stored as SDNN and is not mislabeled as RMSSD.
- RF values and the current fusion model remain simulated.
- RF visualizations represent relative signal response, not verified anatomy.
- The LLM layer is not implemented as a raw biosignal classifier.
- Future medical claims require clinical validation and regulatory assessment.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Local encrypted storage](docs/LOCAL_STORAGE.md)
- [Apple Health / HealthKit](docs/HEALTHKIT.md)
- [Roadmap](docs/ROADMAP.md)
