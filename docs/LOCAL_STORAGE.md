# Local encrypted storage

## Objective

ScanIt stores completed scan sessions locally without placing large health payloads in the operating system key-value store.

## Native design

1. A 256-bit AES key is generated on the device.
2. The key is stored with `expo-secure-store`, backed by iOS Keychain or Android Keystore.
3. Every logical record is serialized and encrypted independently with AES-256-GCM.
4. The record key and schema version are supplied as authenticated additional data, preventing ciphertext from being moved to another logical record without detection.
5. Only ciphertext, schema version and storage timestamp are written to SQLite.
6. SQL parameters are bound rather than interpolated.

The database is therefore not dependent on SQLCipher. The encrypted envelope also allows the storage backend to be replaced later without changing the repository API.

## Web design

The web build is a demonstration target. It keeps records in memory and intentionally does not persist them because browsers do not provide an equivalent OS-backed secret store by default. The UI exposes this difference.

## Stored records

- one encrypted preferences record;
- one encrypted record per scan session;
- maximum 500 sessions retained locally;
- individual records can later be exported or deleted without rewriting the whole history.

## Failure behaviour

A persistence failure does not discard a newly completed in-memory scan. The application exposes a degraded storage status and keeps the medical/research output separate from the storage error.

## Future work

- database migrations and key rotation;
- optional biometric gate for exports;
- crash-safe in-progress scan journal;
- encrypted measurement export package;
- retention policies per research protocol;
- tamper-evident audit events.
