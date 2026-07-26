# ScanIt controlled Wi-Fi sounding transmitter

Reference transmitter for the physical Wi-Fi CSI research path.

## Locked development target

- ESP32-C5
- ESP-IDF 5.5.4
- 5 GHz HT20
- channel 36 by default
- 20 soundings per second by default

The transmitter uses `esp_wifi_80211_tx()` to send an unencrypted non-QoS data frame. The payload contains:

- `SND1` magic and protocol version;
- session nonce;
- 32-bit sounding identifier;
- transmitter-local monotonic timestamp;
- configured channel and sounding rate;
- CRC32 over the sounding payload.

All receiver nodes observe the same over-the-air frame and use its sounding identifier to associate their CSI measurements. The transmitter timestamp is provenance only until a measured transmitter/receiver clock model exists.

## Build

```bash
. $IDF_PATH/export.sh
idf.py set-target esp32c5
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

Do not connect the transmitter as a normal station during controlled capture. The reference implementation supplies its own IEEE 802.11 sequence control and calls `esp_wifi_80211_tx(..., false)`.

## Remaining physical validation

- verify the chosen ESP32-C5 board supports channel 36 under the configured country code;
- verify receiver CSI callbacks are generated for the raw non-QoS sounding frame;
- measure actual packet interval and TX callback failures;
- verify the SND1 payload and CSI callback can be matched on every selected PHY/LTF mode;
- replace the static development session nonce with a gateway-provisioned nonce.
