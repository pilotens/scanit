# Mobile roadmap

## Milestone 1 — scaffold

- [x] Expo Router application
- [x] dashboard, history, sensors, settings
- [x] guided scan state machine
- [x] mock wearable and RF adapters
- [x] explicit simulation and safety boundaries

## Milestone 2 — persistent research application

- [x] encrypted local persistence with OS-protected key
- [x] per-session encrypted records and retention ceiling
- [x] storage health exposed in the application
- [x] onboarding and informed-consent flow
- [x] local user profile
- [x] versioned consent record
- [ ] measurement export package
- [ ] structured logging and crash-safe scan recovery
- [ ] automated unit and integration tests

## Milestone 3 — first real wearable source

- [x] local read-only HealthKit Expo module
- [x] Apple Health authorization flow
- [x] pulse, SDNN HRV, SpO₂ and sleeping wrist-temperature import
- [x] ECG summary import with provenance
- [x] encrypted HealthKit import record
- [x] missing measurements preserved as missing
- [ ] compile and test the Swift bridge in a signed iOS build
- [ ] verify behaviour with real Apple Watch and Apple Health data
- [ ] anchored incremental HealthKit queries
- [ ] background delivery where medically and technically appropriate
- [ ] raw ECG voltage export for research protocols
- [ ] direct watchOS application and synchronized live reference windows

## Milestone 4 — first real RF sensor

- [ ] choose one RF development board
- [ ] add native adapter through an Expo development build
- [ ] preserve raw timestamps and calibration metadata
- [ ] live signal-quality feedback
- [ ] synchronized wearable reference signal
- [ ] compare Wi-Fi CSI, UWB and 60 GHz against the same reference protocol

## Milestone 5 — research protocol support

- [ ] participant IDs separated from identity
- [ ] protocol-defined scan positions
- [ ] operator and self-scan modes
- [ ] reference measurement import
- [ ] blinded model output mode
- [ ] structured adverse-event and false-alert logging

## Milestone 6 — clinical-grade direction

- [ ] locked model versions
- [ ] deterministic safety rules
- [ ] tamper-evident audit trail
- [ ] cybersecurity threat model
- [ ] regulatory classification and clinical evaluation plan
- [ ] prospective multi-centre validation
