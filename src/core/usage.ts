/**
 * Grafo de uso (SPEC §4.3). El código está en `usage/`: `extract.ts` (extractores por lenguaje),
 * `resolve.ts` (rutas, tsconfig, globs) e `index.ts` (`analyzeUsage`). Este archivo solo
 * reexporta, para que los imports de siempre sigan valiendo.
 */
export * from './usage/extract.js';
export * from './usage/index.js';
export * from './usage/resolve.js';
