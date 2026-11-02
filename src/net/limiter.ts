/** Runs at most `concurrency` tasks at once, with starts spaced at least `delayMs` apart. */
export function createLimiter(
  concurrency: number,
  delayMs: number,
): <T>(fn: () => Promise<T>) => Promise<T> {
  const max = Math.max(1, concurrency);
  const queue: Array<() => void> = [];
  let active = 0;
  let nextStart = 0;

  const pump = (): void => {
    while (active < max && queue.length > 0) {
      const start = queue.shift() as () => void;
      active++;
      const now = Date.now();
      const at = Math.max(now, nextStart);
      nextStart = at + delayMs;
      if (at > now) setTimeout(start, at - now);
      else start();
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
}
