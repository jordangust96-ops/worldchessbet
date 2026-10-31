// A UI deadline only. Never use this to retry or cancel a money operation.
export async function challengeReadWithTimeout(read, timeoutMs = 15000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('This challenge is taking longer than expected to load. Check your connection and try again.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
