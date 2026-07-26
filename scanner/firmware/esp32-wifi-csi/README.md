# ESP32-C5 Wi-Fi CSI receiver node

Reference ESP-IDF firmware for a ScanIt physical Wi-Fi CSI receiver.

## Locked development target

- ESP32-C5
- ESP-IDF 5.5.4
- 5 GHz channel 36
- HT20
- controlled SND1 transmitter
- dedicated binary CSI0 UART at 2,000,000 baud by default

## Current scope

The firmware:

- captures CSI from controlled sounding frames;
- parses and CRC-verifies the transmitter's `SND1` payload in the promiscuous callback;
- matches SND1 to the CSI callback using transmitter MAC and the Wi-Fi driver's microsecond RX timestamp;
- copies bounded raw CSI into a FreeRTOS queue without blocking the Wi-Fi task;
- emits `CSI0 v2` with sounding ID, session nonce, receiver and transmitter timestamps, match delta, queue-drop counter and raw int8 CSI bytes;
- keeps PHY/LTF-specific subcarrier interpretation in the gateway;
- sends binary data on a dedicated UART so normal log output cannot corrupt CSI0 framing.

`CSI0` is MCU-to-gateway ingress. The gateway validates it and converts it to WCS1 for encrypted record/replay and analysis.

## Build

```bash
. $IDF_PATH/export.sh
cd scanner/firmware/esp32-wifi-csi
idf.py set-target esp32c5
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

The same projects are built in GitHub Actions with the official ESP-IDF 5.5.4 container.

## Binary UART

Defaults:

- UART port: 1
- TX GPIO: 5
- RX GPIO: 4
- baud rate: 2,000,000

Connect each receiver's CSI0 TX to a separate UART/USB adapter on the gateway computer. Keep the normal USB/JTAG console available for logs and flashing.

## Physical rig

Use:

- one ESP32-C5 controlled sounding transmitter;
- at least two ESP32-C5 CSI receivers;
- three receivers for the current CSI-ratio setup;
- the same 5 GHz channel and HT20 configuration on all nodes;
- fixed transmitter, receiver and body geometry;
- one gateway computer connected to all binary UARTs;
- raw ECG/PPG and a respiratory belt for validation.

The gateway pairs receivers by `(SND1 session nonce, sounding ID)`. Receiver-local packet order is never considered sufficient for physical multi-node capture.

## Measurements to perform after flashing

- confirm that every SND1 frame causes both promiscuous and CSI callbacks;
- characterize the SND1-to-CSI timestamp delta distribution;
- verify the CSI int8 order and the exact PHY/LTF subcarrier map;
- measure queue drops, UART write failures and serial throughput;
- test receiver-start offsets and packet loss;
- measure thermal drift and repeatability in a fixed phantom/fixture;
- compare Wi-Fi periodicity with synchronized ECG/PPG and respiratory references.

## Safety boundary

This node exposes Wi-Fi channel measurements. It does not identify anatomy, blood flow, coronary vessels, stenosis, ischemia or myocardial infarction.
