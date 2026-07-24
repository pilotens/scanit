# Physical BGT60TR13C adapter

## Implemented PoC path

```text
DEMO BGT60TR13C + Radar Baseboard MCU7
              │ high-speed USB
              ▼
ScanIt Python gateway + Infineon RDK
              │ local Wi-Fi / binary WebSocket
              ▼
Mobile GatewayRfScannerProvider
              │ decoded SCN1 frames
              ▼
Calibration → range FFT → phase/micro-motion → RF observation
```

The Infineon demo board already contains the MCU7 bridge used by RDK and can forward raw radar
data over USB. Replacing that vendor firmware is neither necessary nor desirable for the first
physical experiment.

## Control protocol

Each client request is JSON:

```json
{"id":"req-1","type":"configure","payload":{"frameRateHz":20}}
```

Responses:

```json
{"type":"response","requestId":"req-1","ok":true,"payload":{}}
```

Supported requests: `status`, `configure`, `calibrate`, `start`, `stop`, `ping`.
During an active stream, each binary WebSocket message contains exactly one SCN1 packet.

## First experiment

1. Install RDK and its `ifxradarsdk` wheel on a laptop.
2. Connect DEMO BGT60TR13C through USB.
3. Start `python -m scanit_gateway --source infineon`.
4. Put phone and gateway on the same isolated network.
5. Select the gateway on the app's Scanner tab.
6. Run repeated five-second measurements at each marked chest position.
7. Save exact placement, distance, pressure, body posture and a synchronized reference signal.

## What is physically real in this stage

- real ADC data from the three BGT60TR13C RX channels;
- real FMCW sweep configuration;
- real range profiles and inter-frame FFT phase changes;
- real USB/Wi-Fi transport and packet integrity verification.

## What remains experimental

- identification of which reflection corresponds to the heart;
- separation of heartbeat from breathing and gross body motion;
- stable placement across users and sessions;
- any interpretation as tissue, blood, ischemia or disease;
- BLE discovery from the production mobile app;
- full raw-cube archival rather than chirp-averaged real-time frames.

## Productization path

The ESP32-S3 reference firmware supplies BLE discovery/control and WebSocket streaming for a
future embedded bridge. It accepts SCN1 packets over UART so the radar acquisition controller can
be changed without changing the phone protocol.
