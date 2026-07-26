const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REVERSE = new Map([...ALPHABET].map((character, index) => [character, index]));

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    output += ALPHABET[(value >>> 18) & 63];
    output += ALPHABET[(value >>> 12) & 63];
    output += index + 1 < bytes.length ? ALPHABET[(value >>> 6) & 63] : '=';
    output += index + 2 < bytes.length ? ALPHABET[value & 63] : '=';
  }
  return output;
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized.length || normalized.length % 4 !== 0) {
    throw new Error('Invalid base64 scanner payload.');
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((normalized.length / 4) * 3 - padding);
  let outputIndex = 0;

  for (let index = 0; index < normalized.length; index += 4) {
    const characters = normalized.slice(index, index + 4);
    const values = [...characters].map((character) => {
      if (character === '=') return 0;
      const decoded = REVERSE.get(character);
      if (decoded === undefined) throw new Error('Invalid base64 scanner character.');
      return decoded;
    });
    const combined =
      ((values[0] ?? 0) << 18) |
      ((values[1] ?? 0) << 12) |
      ((values[2] ?? 0) << 6) |
      (values[3] ?? 0);
    if (outputIndex < output.length) output[outputIndex++] = (combined >>> 16) & 255;
    if (outputIndex < output.length) output[outputIndex++] = (combined >>> 8) & 255;
    if (outputIndex < output.length) output[outputIndex++] = combined & 255;
  }
  return output;
}
