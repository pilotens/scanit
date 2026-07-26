# Scanner Lab and record/replay

## Purpose

Scanner Lab is the primary research workspace while physical hardware is unavailable or disconnected. It makes every RF experiment reproducible by preserving the original SCN1 packets before interpretation.

## Recording model

Each recording consists of:

1. An encrypted manifest containing source, hardware, position, timestamps, versions and integrity metadata.
2. Ordered chunks containing base64-encoded binary SCN1 packets.
3. CRC32 inside every SCN1 packet.
4. An aggregate CRC32 across the complete ordered recording.

The manifest is written last. An interrupted write therefore cannot appear as a complete recording. Individual recordings can be removed without rewriting the rest of the scanner archive.

## Current limits

- maximum recording size: 32 MiB;
- 16 packets per encrypted storage chunk;
- maximum retained recordings: 40;
- capture duration in the app: 5, 10 or 30 seconds;
- default capture rate: 20 frames per second;
- default calibration prefix: 12 frames.

These limits protect the mobile prototype. A later research workstation format should use an append-only binary container on the file system.

## Replay

Replay performs the following operations against the stored raw frames:

```text
SCN1 decode and CRC verification
  → manifest and sequence validation
  → calibration prefix
  → range/response profile
  → phase and displacement extraction
  → SNR and quality scoring
  → versioned replay summary
```

The current processing version is `scanner-pipeline-v1`. Replaying a recording never changes its raw frames or manifest.

## Comparison

Two replay results can be compared using:

- cosine similarity of the latest normalized profiles;
- average range shift;
- peak displacement difference;
- average SNR difference;
- warnings for different positions, modalities or hardware.

The labels `stable`, `changed` and `significant-change` describe signal differences only. They are not clinical classifications.

## Hardware-independent development

The deterministic emulator generates the same complex frames for the same parameters. It supports:

- UI development;
- storage and corruption tests;
- replay regression tests;
- comparison algorithm development;
- later validation of whether the physical hardware follows the same protocol.

## Next extensions

- raw-cube recording rather than chirp-reduced frames;
- export/import package with an external SHA-256 signature;
- synchronized watch/ECG timestamp tracks;
- operator annotations and protocol-defined placement;
- algorithm benchmark matrix across pipeline versions;
- file-system storage for long recordings;
- spectrogram, range-Doppler and inter-antenna phase views.
