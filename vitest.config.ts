import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // La API real solo existe dentro del editor; en los tests se usa un doble.
    alias: { vscode: fileURLToPath(new URL('./test/fake-vscode.ts', import.meta.url)) },
  },
});
