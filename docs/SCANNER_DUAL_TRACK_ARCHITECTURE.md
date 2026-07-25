# Dual-track scanner architecture

## Purpose

ScanIt separates two physically different research systems. They share session identity, encrypted storage, provenance and export, but they do not share measurement semantics or medical claims.

## Track A — vital motion sensing

Supported sources:

- 60 GHz FMCW radar;
- UWB impulse radar;
- Wi-Fi CSI;
- future Bluetooth channel sounding.

Primary outputs:

- range and phase;
- respiratory motion;
- periodic mechanical motion in a cardiac-frequency band;
- signal coherence and quality;
- personal longitudinal RF baseline.

Track A cannot produce internal anatomical images, coronary-artery images, blood-flow maps or infarction diagnoses.

## Track B — multistatic microwave tomography

Track B is a dedicated coherent microwave measurement system. It is not the Wi-Fi radio in a phone and it is not an ordinary access point.

Minimum research hardware concept:

- 12–16 antenna positions distributed around the thorax or a phantom;
- an RF switch matrix or independently addressable coherent ports;
- common frequency reference and phase-coherent source/receiver;
- stepped-frequency sweep over a multi-gigahertz bandwidth;
- measured antenna poses in a scanner-local coordinate system;
- stable fixture and repeatable subject/phantom position;
- temperature monitoring;
- empty/background and subject captures using identical geometry;
- optional common electrical trigger for external ECG/PPG and motion reference.

Initial engineering target:

- 2–8 GHz configurable coherent sweep;
- at least 16 frequency points for first reconstruction tests;
- at least 100 unique directed TX/RX paths;
- at least 300 degrees aperture coverage;
- no more than 2 mm nominal antenna-position uncertainty;
- phase uncertainty below 0.08 radians for an approved reconstruction;
- background coverage for at least 98% of subject measurements.

These are engineering thresholds for software development. They are not validated medical requirements.

## Tomography measurement flow

```text
Array geometry definition
  → coherent hardware configuration
  → background / empty or reference-phantom capture
  → background quality validation
  → subject / changed-phantom capture
  → exact TX/RX/frequency matching
  → complex S21 subtraction
  → uncertainty weighting
  → tomography quality gate
  → coherent backprojection v1
  → relative scattering-contrast grid
  → phantom/reference comparison
```

## Current inverse model

`tomography-coherent-backprojection-v1` is a first-order focusing method. For every grid position it:

1. calculates the TX-to-pixel and pixel-to-RX propagation distance;
2. calculates the predicted phase for each frequency;
3. phase-conjugates the differential S21 measurement;
4. applies measurement-quality weighting;
5. sums all coherent path-frequency contributions;
6. normalizes the resulting relative contrast map.

The method does not yet solve the full nonlinear electromagnetic inverse-scattering problem. It ignores or simplifies:

- heterogeneous background permittivity;
- strong multiple scattering;
- antenna coupling and near-field pattern variation;
- frequency-dependent tissue dispersion;
- three-dimensional out-of-plane scattering;
- body-boundary uncertainty;
- motion between background and subject captures.

## Required future inverse-model stages

1. measured antenna pattern and coupling calibration;
2. body/phantom boundary estimation;
3. finite-difference or finite-element forward model;
4. distorted Born iterative method or contrast-source inversion;
5. regularization and uncertainty propagation;
6. 3D reconstruction and out-of-plane modelling;
7. registration against CT, MRI or ultrasound reference;
8. blinded phantom and participant validation.

## Claim boundary

The current tomography pipeline may state:

> A differential coherent microwave-scattering contrast was localized within the declared field of view.

It may not state:

- that the contrast is the heart;
- that it is blood or blood flow;
- that it is a coronary artery;
- that it represents stenosis;
- that it represents ischemia or myocardial infarction.

Those claims require suitable spatial resolution, anatomical registration, independent reference imaging and prospective clinical validation.

## Software separation

Track A uses:

- `RawRadioFrame` and SCN1;
- range FFT and phase tracking;
- RX calibration and monotonic timing;
- event-locked mechanical averaging;
- signal-quality and periodicity models.

Track B uses:

- `TomographyCapture`;
- explicit antenna geometry;
- complex S21 path-frequency measurements;
- background calibration and subtraction;
- tomography-specific quality gate;
- relative contrast reconstruction.

No Track A periodicity output is accepted as a Track B anatomical label. No Track B contrast pixel is accepted as a physiological or diagnostic observation.
