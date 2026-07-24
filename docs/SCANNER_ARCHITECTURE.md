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

The first scanner adapter should target the BGT60TR13C. The official demo board has 1 Tx, 3 Rx, raw-data processing and USB forwarding. The connected sensor kit adds Wi-Fi and Bluetooth and can later run custom streaming firmware.

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
  → target-bin selection
  → phase and micro-motion extraction
  → signal-quality scoring
  → position-level RF observation
  → fusion with watch reference
```

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
