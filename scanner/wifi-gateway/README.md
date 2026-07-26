# ScanIt Wi-Fi CSI gateway

This gateway converts ESP32 `CSI0` ingress records into audited `WCS1` frames and streams them to the mobile application over WebSocket.

## Responsibilities

- validate CSI0 v1/v2 header, length and complex byte layout;
- require an explicit PHY-specific subcarrier map;
- convert int8 `[imaginary, real]` CSI into Float32 complex WCS1;
- verify and propagate `SND1` sounding ID, session nonce and callback-match metadata;
- pair two or more receiver nodes by exact `(session nonce, sounding ID)` intersection;
- discard stale unpaired frames rather than pairing by arrival order;
- detect duplicates, transmitter sounding gaps and receiver queue drops;
- map matched soundings into one gateway-monotonic analysis clock with quantified uncertainty;
- expose JSON control and binary WCS1 streaming over one WebSocket;
- never infer anatomy or medical conditions.

## Install

```bash
python -m pip install -e scanner/wifi-gateway
```

## Deterministic three-receiver rig

```bash
scanit-wifi-gateway \
  --source fake \
  --fake-receivers 3 \
  --rx-node-id rx-left \
  --rx-node-id rx-right \
  --rx-node-id rx-reference \
  --host 0.0.0.0 \
  --port 8770
```

The fake sources emit the same explicit SND1 identity fields as physical CSI0 v2 nodes. The app connects to `ws://<gateway-address>:8770`.

## Physical ESP32-C5 rig

Flash:

- one controlled SND1 transmitter from `scanner/firmware/esp32-wifi-sounding`;
- two or three CSI0 v2 receivers from `scanner/firmware/esp32-wifi-csi`.

Connect every receiver's dedicated binary UART to the gateway computer, then run:

```bash
scanit-wifi-gateway \
  --source serial \
  --serial-port /dev/ttyUSB0 \
  --serial-port /dev/ttyUSB1 \
  --serial-port /dev/ttyUSB2 \
  --rx-node-id rx-left \
  --rx-node-id rx-right \
  --rx-node-id rx-reference \
  --baudrate 2000000 \
  --subcarriers=-28:-1,1:28
```

The configured subcarrier list must match the exact CSI layout produced by the selected ESP-IDF target, PHY and LTF configuration. The gateway rejects unknown dimensions instead of guessing a map.

By default, multi-node physical capture requires a validated transmitter sounding ID. CSI0 v1 is still readable for diagnostics, but receiver-local sequence fallback is rejected in strict physical capture.

## Sounding identity

The transmitter places an `SND1` payload in each controlled non-QoS frame:

```text
session nonce + 32-bit sounding ID + TX-local time + channel/rate + CRC32
```

Each receiver matches the payload to its CSI callback using source MAC and Wi-Fi driver RX timestamp. CSI0 v2 transports this identity to the gateway. The gateway only joins frames for which all required receivers expose the same nonce and ID.

This establishes packet identity. It does not create a shared oscillator or absolute phase reference between ESP32 devices.

## Status telemetry

Gateway status reports:

- whether all nodes support explicit sounding ID;
- CSI0 v1/v2 records decoded per receiver;
- cumulative receiver queue drops;
- explicit and fallback sounding batches;
- discarded unpaired frames and duplicate frames;
- detected transmitter sounding gaps;
- active sounding session nonce;
- gateway clock domain and receiver count.

The mobile provider rejects physical captures with insufficient explicit-ID coverage, mixed nonces, queue drops, truncated CSI or excessive SND1-to-CSI callback delta.

## Control protocol

JSON requests use:

```json
{"id":"request-1","type":"status","payload":{}}
```

Supported request types:

- `status`
- `configure`
- `calibrate`
- `start`
- `stop`
- `ping`

Successful responses contain `type=response`, the request ID, `ok=true` and a payload. WCS1 frames are binary WebSocket messages while streaming.

## Clock semantics

Exact SND1 identity ensures all receivers refer to the same transmitted frame. The gateway still assigns a gateway-monotonic midpoint for analysis because receiver clocks are independent. Its uncertainty includes the acquisition span and child uncertainty.

For stronger phase and ECG-gating claims, add a shared hardware trigger, a common reference clock or a separately validated clock-mapping procedure.

## Tests

```bash
python -m unittest discover -s scanner/wifi-gateway/tests -v
```

GitHub Actions also builds both ESP32-C5 firmware projects against ESP-IDF 5.5.4.
