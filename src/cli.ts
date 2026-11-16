#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { buildIndex } from './core/index.js';
import { renderReport } from './report.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    since: { type: 'string' },
    'public-dir': { type: 'string', default: 'public' },
    'include-ignored': { type: 'boolean', default: false },
    entry: { type: 'string', multiple: true },
    ignore: { type: 'string', multiple: true },
    top: { type: 'string', default: '10' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Uso: heftmap [ruta] [opciones]

  --json               Índice completo en JSON
  --since <fecha>      Limitar el historial de git (p. ej. 1.year)
  --public-dir <dir>   Carpeta de recursos públicos (por defecto: public)
  --include-ignored    Incluir carpetas ignoradas por git (node_modules, dist…)
  --entry <ruta>       Punto de entrada extra (repetible)
  --ignore <ruta>      Archivo que nunca cuenta como huérfano (repetible)
  --top <n>            Filas en hotspots y más pesados (por defecto: 10)`);
  process.exit(0);
}

const index = await buildIndex(positionals[0] ?? '.', {
  since: values.since,
  publicDir: values['public-dir'],
  includeIgnored: values['include-ignored'],
  entryPoints: values.entry,
  ignore: values.ignore,
});

if (values.json) console.log(JSON.stringify(index, null, 2));
else console.log(renderReport(index, Number(values.top) || 10));
