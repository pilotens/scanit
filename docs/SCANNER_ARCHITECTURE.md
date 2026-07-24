# Scanner architecture

## Priority

The scanner is the primary research differentiator. The watch remains the continuous trigger and reference clock, while the scanner provides an active, higher-information measurement.

## Radio strategy

The project deliberately separates three measurement goals:

1. **60 GHz FMCW:** cardiac and respiratory micro-motion, range and phase.
2. **UWB impulse radar:** broadband reflectivity and tissue-layer experiments.
3. **Wi-Fi CSI:** inexpensive channel-response research and personal change detection.

Bluetooth is used primarily for control and configuration. Raw high-rate scanner frames should normally use USB or Wi-Fi.

## Selected first hardware

### Infineon BGT60TR13C

The first scanner adapter targets the BGT60TR13C. The official demo board has 1 Tx, 3 Rx, raw-data processing and USB forwarding. The connected sensor kit adds Wi-Fi and Bluetooth and can later run custom streaming firmware.

### NOVELDA X7 Radar Direct

The secondary bench track targets UWB baseband data for tissue-response experiments. It is not the first mobile product transport, but it is valuable for proving whether broadband tissue information exists.

### ESP32 CSI pair

An ESP32-C5/C6 transmitter/receiver pair is retained as a low-cost research comparator. It must not be presented as anatomical imaging.

## Core pipeline

```text
Hardware adapter
  → framed complex IQ data
  → CRC and metadata validation
  → device/position calibration
  → DC and clutter removal
  → windowing and FFT / direct CIR profile
  → multi-bin phase extraction
  → deterministic signal-quality gate
  → respiratory and mechanical-cardiac band separation
  → personal position-specific RF baseline
  → position-level RF observation
  → future fusion with watch reference
```

## Deterministic safety boundary

Before a measurement can be used for baseline or longitudinal comparison, `scanner-quality-v1` evaluates packet continuity, timing, SNR, range stability, target stability, phase continuity, scanner movement, usable-frame ratio and measurement duration.

A blocking condition cannot be overridden by a high aggregate score. The output is `approved`, `repeat` or `rejected`. Only `approved` recordings can update a personal baseline.

## Multi-bin physiological research layer

The system does not assume that the strongest range reflection is cardiac. `scanner-physiology-v1` evaluates several candidate bins and independently selects the bins with the strongest respiratory-band and mechanical-cardiac-band evidence.

The current research bands are:

- respiration: 0.1–0.5 Hz;
- mechanical cardiac motion: 0.7–3.0 Hz.

Outputs are periodic RF-motion estimates and must not be represented as medical heart-rate or breathing diagnoses.

## Personal RF baseline

Baselines are isolated by scanner position, radio modality and hardware profile. Each baseline contains up to twelve technically approved source measurements and preserves source recording identifiers, profile averages and variation in key signal features.

Baseline comparisons report RF-signal change only. They do not identify anatomy, ischemia, infarction or another disease.

## SCN1 frame format

The current transport-neutral frame contains:

- `SCN1` magic and protocol version;
- JSON metadata header;
- little-endian Float32 interleaved IQ payload;
- CRC32 over header and payload.

This is a research format, optimized for auditability and easy firmware implementation rather than maximum throughput. A future production format can use CBOR or FlatBuffers while preserving the same domain model.

## Non-negotiable boundaries

- Raw IQ must remain available for research exports.
- Missing or poor-quality signal must not be interpreted as normal physiology.
- RF maps are relative signal maps, not verified anatomical images.
- Model output must include hardware, firmware, calibration and processing versions.
- Scanner and watch timestamps must later be synchronized to a common monotonic clock.
- A personal baseline may only contain technically approved measurements.
