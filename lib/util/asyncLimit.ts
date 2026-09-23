/**
 * Yield at most `n` items from an async iterable, then stop pulling from it
 * (so an adapter generator stops fetching further pages). `n` of null/0/negative
 * means "no limit" — yield everything.
 */
export async function* takeUpTo<T>(
  src: AsyncIterable<T>,
  n: number | null | undefined,
): AsyncIterable<T> {
  if (n == null || n <= 0) {
    yield* src;
    return;
  }
  let i = 0;
  for await (const item of src) {
    yield item;
    if (++i >= n) return;
  }
}
