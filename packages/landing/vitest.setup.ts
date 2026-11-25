import '@testing-library/jest-dom/vitest';

Element.prototype.scrollIntoView = () => {};

const store = new Map<string, string>();

const localStorageMock: Storage = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
  clear: (): void => {
    store.clear();
  },
  key: (index: number): string | null => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
};

for (const target of [globalThis, window]) {
  Object.defineProperty(target, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = await import('node:util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}
