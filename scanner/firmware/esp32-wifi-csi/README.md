# ESP32 Wi-Fi CSI receiver node

Reference ESP-IDF firmware for a ScanIt Wi-Fi CSI receiver node.

## Current scope

- enables CSI capture on supported ESP32-C5/C6-class targets;
- copies bounded CSI data from the Wi-Fi driver callback into a FreeRTOS queue;
- records node-local monotonic time, channel, antenna, MCS, RSSI and noise floor;
- emits packed `CSI0` header + raw int8 CSI bytes on the selected serial transport;
- leaves PHY/LTF-specific subcarrier interpretation to the gateway;
- never serializes or blocks inside the Wi-Fi callback.

`CSI0` is MCU-to-gateway ingress. It is not the application record format. The gateway validates and converts it to WCS1.

## Build

```bash
cd scanner/firmware/esp32-wifi-csi
idf.py set-target esp32c6
idf.py build
idf.py flash monitor
```

The target and CSI configuration must be checked against the installed ESP-IDF version. The reference uses conditional configuration for newer HE-capable targets and the legacy CSI configuration for older targets.

## Physical rig

Use at least:

- one controlled transmitter;
- two receiver nodes for CSI-ratio sensing;
- three receivers for the current reference setup;
- fixed node and body geometry;
- one gateway computer connected to all receiver serial ports;
- synchronized ECG/PPG and respiratory reference signals for validation.

## Remaining hardware work

- replace stdout reference writes with the selected USB/JTAG serial or dedicated UART transport;
- add an explicit sounding identifier derived from the controlled transmitter rather than relying on receiver-local packet order;
- measure dropped callback records and queue overflow;
- validate exact CSI byte ordering and subcarrier map for every PHY/LTF mode;
- add a common trigger or independently validated clock synchronization;
- compile and flash on the selected ESP32 target;
- measure sustained throughput and temperature drift.

## Safety boundary

This node exposes Wi-Fi channel measurements. It does not identify anatomy, blood flow, coronary vessels, stenosis, ischemia or myocardial infarction.
