# Heft

Extensión para Cursor (y VS Code) que responde a una pregunta: **¿qué pesa en este repo y se está usando?**

- Peso de cada archivo y carpeta: tabla, árbol y treemap.
- Uso: quién referencia cada archivo y qué recursos no tienen rastro de uso.
- Último cambio en git y **hotspots** (líneas × frecuencia de cambio).

Estado: **fase 1**. Vista lateral «Carpetas» con tamaños y casillas de ámbito, comandos, menú
contextual del explorador y barra de estado. El panel con tabla y treemap llega en la fase 2.
Diseño completo en [SPEC.md](SPEC.md); resultados de la fase 0 en [docs/fase-0.md](docs/fase-0.md).

**Instalar y probar en Cursor: [prepareextension.md](prepareextension.md).**

## CLI (fase 0)

```bash
npm install
npm run build
node dist/cli.js /ruta/al/repo            # informe legible
node dist/cli.js /ruta/al/repo --json     # índice completo en JSON
node dist/cli.js /ruta/al/repo --since 1.year
```

## Desarrollo

```bash
npm test          # vitest (núcleo, lógica de la extensión y humo contra un vscode simulado)
npm run typecheck # tsc --noEmit
npm run package   # heft.vsix
```

- `src/core/`: núcleo sin dependencia de `vscode` (listado, git, uso).
- `src/extension/`: la extensión. `scope.ts` y `tree-model.ts` son lógica pura con tests;
  `extension.ts` es la capa de `vscode`. El análisis corre en un worker: `runner.ts` lo lanza y
  `worker.ts` ejecuta el núcleo (bundle aparte, `dist/worker.cjs`).
- `test/fake-vscode.ts`: doble de la API para el test de humo (alias en `vitest.config.ts`).
