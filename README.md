# ScanIt

ScanIt is an early mobile research platform for combining continuous wearable measurements with a guided, extended RF scan.

The current repository contains a runnable **Expo/React Native prototype** with simulated sensor data. It does not diagnose, predict, or exclude myocardial infarction or any other medical condition.

## Current mobile scope

- Swedish dashboard for wearable vitals and personal baseline
- Guided extended scan workflow
- Modular interfaces for wearable and RF sensor providers
- Simulated fusion of ECG/PPG/SpO₂-style data and RF observations
- Scan history, sensor inventory, research settings, and safety wording
- Domain models designed for future Wi-Fi CSI, Bluetooth Channel Sounding, UWB, and 60 GHz adapters

## Technology

- Expo SDK 57
- React Native 0.86
- React 19.2
- TypeScript
- Expo Router

Expo Router is used because Expo recommends it for new Expo applications and it provides file-based routing across Android, iOS, and web.

## Run locally

```bash
npm install
npm run start
```

Then open the project in Expo Go, an emulator, or the web target.

## Validation

```bash
npm run typecheck
npm run lint
```

## Important boundaries

- All measurements in this version are simulated.
- RF visualizations represent relative signal response, not verified anatomy.
- The LLM layer is not implemented as a raw biosignal classifier.
- Future medical claims require clinical validation and regulatory assessment.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Roadmap](docs/ROADMAP.md)
