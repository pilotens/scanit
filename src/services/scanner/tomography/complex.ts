import type { TomographyComplex } from '@/domain/tomography';

export const tomographyAdd = (
  left: TomographyComplex,
  right: TomographyComplex,
): TomographyComplex => ({
  real: left.real + right.real,
  imaginary: left.imaginary + right.imaginary,
});

export const tomographySubtract = (
  left: TomographyComplex,
  right: TomographyComplex,
): TomographyComplex => ({
  real: left.real - right.real,
  imaginary: left.imaginary - right.imaginary,
});

export const tomographyMultiply = (
  left: TomographyComplex,
  right: TomographyComplex,
): TomographyComplex => ({
  real: left.real * right.real - left.imaginary * right.imaginary,
  imaginary: left.real * right.imaginary + left.imaginary * right.real,
});

export const tomographyScale = (
  value: TomographyComplex,
  scale: number,
): TomographyComplex => ({
  real: value.real * scale,
  imaginary: value.imaginary * scale,
});

export const tomographyConjugate = (value: TomographyComplex): TomographyComplex => ({
  real: value.real,
  imaginary: -value.imaginary,
});

export const tomographyMagnitude = (value: TomographyComplex) =>
  Math.hypot(value.real, value.imaginary);

export const tomographyPhase = (value: TomographyComplex) =>
  Math.atan2(value.imaginary, value.real);

export const tomographyExponential = (phaseRadians: number): TomographyComplex => ({
  real: Math.cos(phaseRadians),
  imaginary: Math.sin(phaseRadians),
});
