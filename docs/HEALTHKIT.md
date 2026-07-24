# Apple Health / HealthKit integration

## Scope

The first native wearable integration is read-only HealthKit access on iOS. ScanIt imports summaries already stored in Apple Health; it does not communicate directly with Apple Watch and does not receive a synchronized raw waveform stream.

Imported data:

- latest heart-rate sample;
- latest heart-rate variability sample using HealthKit's SDNN metric;
- latest oxygen-saturation sample;
- latest sleeping wrist-temperature sample when supported;
- up to 20 recent electrocardiogram summaries, including classification, average heart rate, sample count and provenance.

Raw ECG voltage measurements are deliberately not imported in this milestone.

## Architecture

```text
Apple Watch / other HealthKit source
              ↓
          Apple Health
              ↓
ScanItHealthKit local Expo module (read only)
              ↓
HealthKit import service and provenance mapping
              ↓
AES-256-GCM encrypted local record
              ↓
Dashboard, sensor status and extended-scan context
```

The local module lives in `modules/scanit-healthkit` and contains:

- an Expo config plugin for the HealthKit entitlement and privacy text;
- an Expo Modules API TypeScript surface;
- an iOS Swift implementation backed by `HKHealthStore`;
- safe Android, web and missing-native-module fallbacks.

## Authorization behaviour

The app first explains the requested data and records local consent. iOS then displays Apple's authorization sheet. ScanIt requests read access only and asks for no write types.

HealthKit protects read authorization privacy. The app cannot reliably distinguish an explicitly denied read type from a type that simply has no samples. Missing values must therefore remain missing and must not be interpreted as normal findings.

## Measurement semantics

HealthKit provides heart-rate variability as SDNN. It must not be placed in an RMSSD field. `VitalSnapshot` stores the two methods separately:

- `hrvSdnnMs` for HealthKit imports;
- `hrvRmssdMs` for future raw PPG/ECG processing and the current simulator.

Sleeping wrist temperature is not treated as equivalent to continuous skin temperature. The UI labels it as the latest available sleeping wrist-temperature measurement.

## Build requirements

Expo Go does not contain the custom native module. A usable HealthKit build requires:

1. Apple developer signing for `com.scanit.health`;
2. the HealthKit capability for the app identifier;
3. Expo prebuild or an EAS/local native build;
4. testing on a physical iPhone with Apple Health data.

Generate the iOS project with:

```bash
npm install
npm run prebuild:ios
```

The generated project is not committed. Continuous integration validates configuration generation, but an actual Swift/Xcode build still requires a macOS runner or EAS Build.

## Safety boundaries

- Imported summaries may be old and are not synchronized to the RF scan.
- An Apple ECG classification is not a myocardial-infarction detector.
- A missing or apparently normal HealthKit value cannot rule out acute disease.
- Imported data may originate from Apple Watch or another application/device; source metadata is retained.
- The current RF adapter and risk model remain simulated.
