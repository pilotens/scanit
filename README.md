# ScanIt

ScanIt is an early mobile research platform for developing spatially tracked multimodal body imaging with ultrasound, microwave/RF, motion sensing, and explicit measurement provenance.

The current repository contains a runnable **Expo/React Native prototype** with simulated sensor data. It does not diagnose, predict, or exclude myocardial infarction or any other medical condition.

## Current mobile scope

- Swedish dashboard for wearable vitals and personal baseline
- Guided extended scan workflow
- Modular interfaces for wearable and RF sensor providers
- Simulated fusion of ECG/PPG/SpO₂-style data and RF observations
- Scan history, sensor inventory, research settings, and safety wording
- Multimodal imaging contracts for ultrasound, microwave, UWB/mmWave, pose tracking, voxels, confidence, and provenance\n- Deterministic evidence-grid reconstruction baseline and synthetic chest-sweep generator

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
npm run mvp:check
```

## Important boundaries

- All measurements in this version are simulated.
- RF visualizations represent relative signal response, not verified anatomy.
- The LLM layer is not implemented as a raw biosignal classifier.
- Future medical claims require clinical validation and regulatory assessment.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Roadmap](docs/ROADMAP.md)\n- [Multimodal imaging architecture](docs/IMAGING_ARCHITECTURE.md)
- [Hardware handoff](docs/HARDWARE_HANDOFF.md)

## iPhone 15 Pro Max — Expo Go phone-only mode

The `/phone-sensors` route uses the iPhone's real accelerometer via `expo-sensors`. It records a 15-second movement/vibration window and reports raw-signal summary statistics. It does **not** image internal anatomy, measure ECG, or diagnose disease. The separate `/imaging` route remains explicitly synthetic.

To launch on a physical iPhone:

```bash
npm install
npx expo start --tunnel
```

Install Expo Go on the phone and scan the terminal QR code. The developer computer must remain running during the session. Expo Go must support the project's Expo SDK; if not, align the SDK with the currently supported Expo Go version or build a development client.

There is no remote phone installation from GitHub alone.

## Sharing browser motion measurements

On the web `/phone-sensors` route, **Kopiera kort resultat** copies a compact JSON
summary of the latest measurement. It contains signal quality, capture details,
SCG/GCG/RESP findings and comparison summaries. Raw sample arrays, waveform data
and historical reports are excluded, so collecting more measurements does not
make the clipboard result grow. The timestamp identifies when the measurement
finished. Missing channels remain explicitly unavailable.

**Spara fullständig JSON** downloads the complete export, including every captured
accelerometer/gyroscope sample and locally stored measurement history. Attach this
file for analysis of a particular moment or to reprocess the time series. Neither
action uploads data automatically. If clipboard access is blocked, the compact
result is shown in a selectable field for manual copying.

The full export retains the existing accelerometer rounding (milliseconds and five
decimal places for acceleration) and the original gyroscope serialization. The
`multimodal.accelerationStartMs` offset aligns acceleration elapsed times with the
session clock. The current `exploratoryScg` event and gap timestamps are absolute
`performance.now()` delivery times; subtract `multimodal.sessionOriginMs` to express
them relative to the current session. Historical reports retain their own clocks;
the current session origin does not apply to their timestamps.
The compact export rounds summary numbers for readability and is not suitable for
exact-time waveform analysis. All physiological interpretations remain exploratory.

Run the export regression checks with `npm run test:exports`. They also run as part
of `npm run mvp:check` in CI and before the GitHub Pages deployment.

