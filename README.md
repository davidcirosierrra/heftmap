# Heft

Extensión para Cursor (y VS Code) que responde a una pregunta: **¿qué pesa en este repo y se está usando?**

- Peso de cada archivo y carpeta: tabla, árbol y treemap.
- Uso: quién referencia cada archivo y qué recursos no tienen rastro de uso.
- Último cambio en git y **hotspots** (líneas × frecuencia de cambio).

Estado: fase 0 hecha, el núcleo funciona como CLI ([resultados](docs/fase-0.md)). La extensión todavía no existe.
Diseño completo en [SPEC.md](SPEC.md).

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
npm test          # vitest
npm run typecheck # tsc --noEmit
```

El núcleo (`src/core/`) no depende de la API de `vscode`, para poder probarlo fuera del editor.
