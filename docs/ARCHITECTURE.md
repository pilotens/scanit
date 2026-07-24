# Mobile architecture

## Goals

The mobile application must remain useful while the sensor hardware evolves. Wearable, Wi-Fi CSI, Bluetooth Channel Sounding, UWB, and mmWave implementations therefore sit behind stable provider interfaces.

## Runtime layers

```text
Expo Router screens
        ↓
Application state and scan hooks
        ↓
ScanCoordinator
        ↓
WearableSensorProvider + RfScannerProvider
        ↓
Mock adapters now / native hardware adapters later
```

## Safety separation

The future analysis stack should be separated into:

1. Signal quality models
2. Specialized ECG, PPG, RF, and motion models
3. Personal baseline and anomaly models
4. Multimodal fusion and calibrated risk output
5. Deterministic medical safety rules
6. Optional LLM for structured dialogue and explanation

The LLM must not infer raw measurements, override emergency rules, or present generated anatomy as measured anatomy.

## Hardware integration path

Hardware adapters should implement the interfaces in `src/services/sensors/types.ts`.

Native hardware access will require Expo development builds and native modules. The app is intentionally using simulators until a selected development board exposes stable raw data.

## Storage path

The first scaffold keeps data in memory. The next storage layer should support:

- encrypted local database
- immutable raw measurement manifests
- model and calibration versioning
- explicit consent for export
- separation of identity and physiological data
