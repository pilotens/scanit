# ScanIt Wi-Fi CSI gateway

This gateway converts bounded ESP32 `CSI0` ingress records into audited `WCS1` frames and streams them to the mobile application over WebSocket.

## Responsibilities

- validate CSI0 header, length and real/imaginary byte layout;
- require an explicit PHY-specific subcarrier map;
- convert int8 CSI into Float32 complex WCS1 values;
- aggregate at least two receiver nodes into one sounding sequence;
- map software-aligned captures into one gateway-monotonic clock domain;
- report timing uncertainty and `software-aligned-multinode` flags;
- expose JSON control and binary WCS1 streaming over one WebSocket;
- never infer anatomy or medical conditions.

## Install

```bash
python -m pip install -e scanner/wifi-gateway
```

## Run the deterministic three-receiver rig

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

The app connects to `ws://<gateway-address>:8770`.

## Run physical ESP32 nodes

```bash
scanit-wifi-gateway \
  --source serial \
  --serial-port /dev/ttyACM0 \
  --serial-port /dev/ttyACM1 \
  --serial-port /dev/ttyACM2 \
  --rx-node-id rx-left \
  --rx-node-id rx-right \
  --rx-node-id rx-reference \
  --baudrate 2000000 \
  --subcarriers=-28:-1,1:28
```

The configured subcarrier list must match the exact CSI layout produced by the selected ESP-IDF target, PHY and LTF configuration. The gateway rejects unknown dimensions instead of guessing a map.

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

Successful responses contain `type=response`, the request ID, `ok=true` and a payload. WCS1 frames are sent as binary WebSocket messages while streaming.

## Clock semantics

A multi-node gateway reads receiver sources concurrently and assigns one gateway-monotonic midpoint to each sounding. Its uncertainty includes half of the batch acquisition span plus child timestamp uncertainty. This is a quantified software alignment method, not hardware synchronization.

For stronger scientific claims, replace it with a common trigger, shared oscillator or independently validated clock mapping.

## Tests

```bash
python -m unittest discover -s scanner/wifi-gateway/tests -v
```
