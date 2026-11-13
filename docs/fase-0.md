# Fase 0 — validación del núcleo con repos reales

Fecha: 13-11-2026. Núcleo (`src/core/`) ejecutado como CLI, sin interfaz.
Objetivo (SPEC §5): medir tiempos y contar cuántos «sin rastro» son falsos antes de construir la extensión.

## Repos probados

| Repo | Archivos | Tamaño | Commits leídos | Tiempo total |
|------|---------:|-------:|---------------:|-------------:|
| `FEOS_PERO_MAJOS_SURVIVAL` (Vite + React + Three.js, sprites generados en código) | 79 | 718 KB | 32 | ~0,2–0,3 s |
| Mismo repo con `--include-ignored` (`node_modules` de 252 MB) | 79 + 1 | — | 32 | ~0,9 s |
| `vitejs/vite` (monorepo, VitePress, playgrounds; clon de 500 commits) | 3.006 | 17,1 MB | 500 | ~2 s |

El análisis de uso es la parte cara (75–85 % del tiempo). Para la extensión: calcular en segundo plano
y actualizar de forma incremental (SPEC §4.3), sin worker de momento.

## Resultados

### Feos pero majos survival

- **0 sin rastro, 0 mencionados, 0 código sin importadores.**
- Contraste con Knip: su único «archivo sin usar» es `scripts/gen-icons.mjs`, que Heft trata a propósito
  como punto de entrada (script de tooling que se ejecuta a mano). Ningún huérfano se le escapa a Heft.
- Los iconos PWA se declaran en `vite.config.ts`: se detectan porque los configs se leen como origen.
- Los sprites son código generado (`*.gen.ts`): quedan fuera de los hotspots, como debe ser.
- Hotspots útiles: `src/index.css` (1.746 líneas, 19 cambios) y `src/game/store.ts` (681 líneas, 17 cambios).

### vitejs/vite

- Primera pasada: **21 sin rastro, 20 falsos**. Tras los arreglos: **1 sin rastro, y es real**
  (`docs/public/logo-uwu.webp`, no aparece en ningún archivo).
- 43 mencionados: rutas montadas en ejecución (`/trusted-by/${name}.svg`) y nombres genéricos
  (`graph.svg` coincide con la palabra «graph» en decenas de archivos).
- 589 «código sin importadores»: convenciones de framework (config de VitePress, plantillas de
  `create-vite`, playgrounds). Confirma que el veredicto sobre código no es fiable y debe ir aparte (Knip).

## Falsos positivos encontrados y corregidos

| Síntoma | Causa | Arreglo |
|---------|-------|---------|
| Código citado en el README cuenta como usado | Strings entre backticks del Markdown leídos como rutas | En Markdown solo enlaces e `<img>` hacia recursos y documentos |
| Un archivo citado en un comentario JSDoc cuenta como usado | Strings leídos con regex sobre todo el texto | En TS/JS, literales leídos del AST (sin comentarios) |
| Un generador «usa» lo que genera | Strings de `scripts/` y Python cuentan como referencia | Referencias desde tooling bajan a «mención» |
| Imágenes importadas desde `.vue` salen sin rastro | Componentes `.vue/.svelte/.astro` no se leían | Se leen: imports, atributos de plantilla y strings |
| `![…](/og.webp)` en VitePress no se resuelve | Solo se buscaba `public/` en la raíz | Carpeta pública más cercana subiendo desde el archivo (`docs/public`, `packages/x/public`) |
| Workflows de `.github/` salen como recursos sin rastro | YAML clasificado como recurso | YAML/TOML y carpetas con punto → configuración |
| `wiz.svg` sin rastro aunque se usa como `'wiz'` | Raíces de menos de 4 letras no se buscaban | Mínimo 3 letras (mejor un «mencionado» de más que un «sin rastro» falso) |

## Decisiones técnicas que salen de la fase 0

- **TypeScript 7** (la actual, y la que usa Feos pero majos) es nativa y **no expone la API del
  compilador** (`preProcessFile`, `resolveModuleName`, `createSourceFile`). Heft fija su propia
  `typescript@5.9.3` solo para leer imports y strings; no depende de la versión del proyecto analizado.
- En el bundle, `typescript` va como dependencia externa (empaquetado dentro de ESM falla por `__filename`).
  Para la extensión (CommonJS) habrá que decidir si se empaqueta o se incluye en `node_modules` del `.vsix`.

## Pendiente para la siguiente fase

- La lista de «mencionado en» puede ser enorme con nombres genéricos: en la UI, mostrar los 3 primeros.
- ~~`import.meta.glob` de Vite no se interpreta~~: resuelto en la revisión posterior a la fase 1,
  junto con los JSON de configuración y los alias hacia recursos (SPEC §3.3).
- El análisis de uso es síncrono: en un repo de miles de archivos bloquea el proceso de extensiones
  1–2 s por análisis. Pendiente: worker o análisis incremental.
- Paths de Windows: sin probar.
