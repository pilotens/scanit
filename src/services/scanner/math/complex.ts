export type Complex = { real: number; imaginary: number };

export const magnitude = ({ real, imaginary }: Complex) => Math.hypot(real, imaginary);

export const phase = ({ real, imaginary }: Complex) => Math.atan2(imaginary, real);

export const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;

export const hannWindow = (length: number) =>
  Array.from({ length }, (_, index) =>
    length <= 1 ? 1 : 0.5 * (1 - Math.cos((2 * Math.PI * index) / (length - 1))),
  );

export function fft(input: Complex[]): Complex[] {
  const length = input.length;
  if (!isPowerOfTwo(length)) {
    throw new Error(`FFT length must be a power of two. Received ${length}.`);
  }

  const output = input.map((sample) => ({ ...sample }));

  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      const temporary = output[index];
      output[index] = output[reversed]!;
      output[reversed] = temporary!;
    }
  }

  for (let blockSize = 2; blockSize <= length; blockSize <<= 1) {
    const angle = (-2 * Math.PI) / blockSize;
    const twiddleStep = { real: Math.cos(angle), imaginary: Math.sin(angle) };

    for (let offset = 0; offset < length; offset += blockSize) {
      let twiddle = { real: 1, imaginary: 0 };
      for (let index = 0; index < blockSize / 2; index += 1) {
        const even = output[offset + index]!;
        const oddSource = output[offset + index + blockSize / 2]!;
        const odd = {
          real: oddSource.real * twiddle.real - oddSource.imaginary * twiddle.imaginary,
          imaginary: oddSource.real * twiddle.imaginary + oddSource.imaginary * twiddle.real,
        };

        output[offset + index] = {
          real: even.real + odd.real,
          imaginary: even.imaginary + odd.imaginary,
        };
        output[offset + index + blockSize / 2] = {
          real: even.real - odd.real,
          imaginary: even.imaginary - odd.imaginary,
        };

        twiddle = {
          real: twiddle.real * twiddleStep.real - twiddle.imaginary * twiddleStep.imaginary,
          imaginary:
            twiddle.real * twiddleStep.imaginary + twiddle.imaginary * twiddleStep.real,
        };
      }
    }
  }

  return output;
}

export const wrapPhase = (value: number) => {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
};

export const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

export const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));
