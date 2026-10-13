// Safari (including iOS 26) can't `for await` over a ReadableStream, which pdf.js relies on to
// read page text ("undefined is not a function (near '...e of t...')"). Teach it how.
// Imported first in main.tsx, before anything that might iterate a stream.

type IterableStream = ReadableStream & { [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown> };

if (typeof ReadableStream !== "undefined" && !(ReadableStream.prototype as IterableStream)[Symbol.asyncIterator]) {
  const values = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
  Object.defineProperty(ReadableStream.prototype, "values", { value: values, writable: true, configurable: true });
}

export {};
