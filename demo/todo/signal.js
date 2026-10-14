// TODO: Make the smoothing window configurable.
// FIXME: Handle an empty input sequence.

export function average(samples) {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}
