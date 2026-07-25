# Scanner architecture

## Priority

The scanner is the primary research differentiator. ScanIt now contains two physically and analytically separate scanner tracks.

They share:

- session and participant identifiers;
- provenance and hardware versions;
- encrypted storage and export;
- deterministic quality gates;
- explicit interpretation boundaries.

They do not share raw measurement models, inverse algorithms or medical claims.

## Track A — vital motion sensing

Sources:

1. **60 GHz FMCW:** range, phase, coherence and kardiorespiratory micro-motion.
2. **UWB impulse radar:** broadband time-domain response experiments.
3. **Wi-Fi CSI:** low-cost channel-response, movement and personal change research.
4. **Bluetooth channel sounding:** future experimental comparison source.

Bluetooth or Wi-Fi may transport data, but the BGT60TR13C radar performs the primary 60 GHz measurement.

### Track A pipeline

```text
Hardware adapter / emulator
  → SCN1 raw frame
  → CRC and dimensions
  → full RX × chirp × ADC preservation
  → per-RX gain/phase calibration
  → range FFT per chirp and RX
  → physical target tracking
  → chirp/RX coherence and timing quality
  → scanner-quality-v3
  → calibrated multi-bin physiology-v3
  → optional ECG/PPG event-locked mechanical averaging
  → personal RF baseline
  → physical-signal evidence boundary
```

Track A may support statements about range, phase, coherent mechanical response and periodic RF motion. It cannot identify internal anatomy, blood flow, coronary vessels, stenosis, ischemia or myocardial infarction.

## Track B — multistatic microwave tomography

Track B requires a dedicated coherent array around the phantom or thorax. It does not use the phone's ordinary Wi-Fi radio as an imaging instrument.

Current software profile:

- 12–16 measured antenna positions;
- coherent stepped-frequency S21 acquisition;
- experimental 2–8 GHz hardware range;
- explicit TX/RX/frequency measurements;
- background and subject captures using identical geometry;
- phase, magnitude, geometry and temperature uncertainty;
- dedicated tomography quality gate;
- first-order differential coherent backprojection.

### Track B pipeline

```text
Array geometry
  → coherent sweep configuration
  → background capture
  → subject / changed-phantom capture
  → schema and path-frequency validation
  → exact background matching
  → complex differential S21
  → uncertainty weighting
  → tomography-quality-v1
  → coherent-backprojection-v1
  → relative scattering-contrast grid
  → phantom or independent reference comparison
```

Track B output is a relative differential scattering-contrast map. It is not a verified anatomical image.

## Vital-track physical hardware

### Infineon BGT60TR13C

The selected first vital-motion adapter uses 1 Tx and 3 Rx. The gateway preserves the complete RX × chirp × ADC cube and timestamps each frame in a boot-unique monotonic clock domain.

### NOVELDA X7 Radar Direct

The secondary vital track provides broadband baseband data for tissue-response and layer-boundary experiments. A single-channel system is not multistatic tomography.

### ESP32 CSI pair

The Wi-Fi CSI pair is a low-cost comparator for channel changes, motion and personal baseline. It must not be presented as internal imaging.

## Tomography research hardware

The tomography hardware profile is intentionally abstract. A future implementation may use:

- a vector network analyzer or coherent software-defined RF frontend;
- an RF switch matrix;
- independently addressable antenna ports;
- a ring, vest or fixed phantom fixture;
- measured port and antenna calibration;
- common electrical triggering.

The first physical implementation must conform to the `TomographyScannerProvider` contract.

## Quality and calibration

### Vital track

`scanner-quality-v3` checks raw-cube preservation, RX calibration, monotonic timing, timestamp uncertainty, packet continuity, SNR, chirp/RX coherence, target confidence, range/phase stability, motion and usable duration.

### Tomography track

`tomography-quality-v1` checks:

- compatible background and subject captures;
- stable background calibration;
- active antenna count and angular coverage;
- coherent frequency count and bandwidth;
- unique multistatic path count;
- background measurement coverage;
- phase uncertainty;
- antenna-position uncertainty;
- temperature match.

Blocking conditions cannot be overridden by a high aggregate score.

## Data formats

### SCN1

Vital-motion frames contain:

- `SCN1` magic and protocol version;
- JSON metadata;
- little-endian Float32 sample payload;
- CRC32;
- complete acquisition, timing and calibration provenance.

### TomographyCapture

Tomography captures contain:

- antenna geometry and field of view;
- coherent frequency sweep;
- complex S21 for each directed TX/RX/frequency point;
- magnitude and phase uncertainty;
- background/subject role and reference capture;
- temperature and hardware profile.

## Non-negotiable boundaries

- Raw vital frames and tomography path measurements remain available for audit and replay.
- Missing or poor-quality data is not interpreted as normal physiology.
- A periodic RF signal is not proof that the reflector is myocardium.
- A scattering-contrast pixel is not proof of anatomy or pathology.
- Track A output cannot label Track B pixels.
- Track B output cannot create vital or diagnostic observations.
- Any anatomical or medical claim requires phantom validation, independent reference imaging and prospective clinical evidence.

See [Dual-track scanner architecture](SCANNER_DUAL_TRACK_ARCHITECTURE.md) for the physical tomography requirements and inverse-model roadmap.
