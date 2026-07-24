# Mobile roadmap

## Milestone 1 — scaffold

- Expo Router application
- dashboard, history, sensors, settings
- guided scan state machine
- mock wearable and RF adapters
- explicit simulation and safety boundaries

## Milestone 2 — persistent research application

- [x] encrypted local persistence with OS-protected key
- [x] per-session encrypted records and retention ceiling
- [x] storage health exposed in the application
- [ ] onboarding and informed-consent flow
- [ ] user and device profiles
- [ ] measurement export package
- [ ] structured logging and crash-safe scan recovery
- [ ] automated unit and integration tests

## Milestone 3 — first real sensor

- choose one RF development board
- add native adapter through an Expo development build
- preserve raw timestamps and calibration metadata
- live signal-quality feedback
- synchronized wearable reference signal

## Milestone 4 — research protocol support

- participant IDs separated from identity
- protocol-defined scan positions
- operator and self-scan modes
- reference measurement import
- blinded model output mode

## Milestone 5 — clinical-grade direction

- locked model versions
- deterministic safety rules
- audit trail
- cybersecurity threat model
- regulatory classification and clinical evaluation plan
