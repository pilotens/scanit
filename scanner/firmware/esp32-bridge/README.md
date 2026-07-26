# ESP32-S3 transport bridge firmware

This ESP-IDF reference firmware is the standalone transport path for a later ScanIt scanner.
It does **not** replace Infineon's MCU7 radar bridge firmware and does not directly configure
the BGT60TR13C in the first PoC.

## Functions

- creates a WPA2 Wi-Fi access point named `ScanIt-Scanner`;
- exposes a binary WebSocket endpoint at `ws://192.168.4.1/stream`;
- advertises a custom BLE GATT service for endpoint discovery and START/STOP control;
- receives length-prefixed `SCN1` packets over UART;
- validates SCN1 version, packet length and CRC32 before forwarding;
- streams only while enabled through BLE or WebSocket control.

## UART ingress

The upstream controller sends:

```text
uint32_le packet_length
packet_length bytes containing one complete SCN1 packet
```

The Python/USB gateway does not need this firmware. It streams directly to the mobile app.
This project becomes useful when the radar acquisition controller is moved into a compact
battery-powered enclosure.

## Build

```bash
idf.py set-target esp32s3
idf.py menuconfig
idf.py build flash monitor
```

Change the default access-point password before any test outside an isolated bench network.
The firmware is a reference implementation and still requires validation on a selected ESP32-S3
board, UART electrical integration and long-duration throughput testing.
