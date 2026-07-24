# ScanIt physical scanner gateway

This service connects the **DEMO BGT60TR13C / Radar Baseboard MCU7** to the mobile app.
The board remains connected to a laptop or small Linux gateway through high-speed USB. The
gateway uses Infineon's Radar Development Kit (RDK) Python API and streams one `SCN1`
binary frame per WebSocket message.

## Why a gateway is required

The mobile app cannot directly load Infineon's desktop USB driver or Python wheel. Bluetooth
is also unsuitable for sustained raw radar cubes. The first PoC therefore uses:

- USB: board to gateway computer;
- WebSocket over local Wi-Fi: gateway to phone;
- JSON control messages and binary `SCN1` frames on the same socket;
- optional ESP32 companion firmware for BLE discovery/control and later standalone bridging.

## Install

1. Install Infineon's Radar Development Kit on the gateway computer.
2. Install the `ifxradarsdk` wheel from the RDK `python_wheels` directory.
3. Install this gateway:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -e scanner/gateway
python -m scanit_gateway --source infineon --host 0.0.0.0 --port 8765
```

Use `--uuid <board UUID>` when several boards are connected. For development without hardware:

```bash
python -m scanit_gateway --source fake
```

Then enter `ws://<gateway-ip>:8765` on the Scanner tab.

## Current acquisition profile

- 58–63 GHz FMCW sweep
- 128 ADC samples per chirp
- 32 chirps per frame
- 20 frames/s
- RX mask `0b111`, TX mask `0b001`

The gateway currently reduces each short chirp burst to one range vector per RX antenna by
averaging across chirps. A later recorder will preserve complete raw radar cubes in a binary
research archive while continuing to send reduced real-time frames to the phone.

## Security boundary

The current gateway is for an isolated laboratory LAN. It has no authentication or TLS. Do not
expose port 8765 to the internet or use it for identifiable clinical data. Mutual authentication,
TLS and device-bound pairing are required before field studies.
