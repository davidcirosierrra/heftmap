# Heft — especificación v2 (auditor de peso y uso)

> **Para retomar en otra conversación:** adjunta este archivo (y la carpeta `docs/capturas-v1/`) y di
> «Seguimos con la extensión Heft según SPEC.md v2».
> Diseño interactivo v2: https://claude.ai/artifact/SM6p8UJHZht4bQe87xk3Ph
> Diseño v1 (histórico): https://claude.ai/artifact/CHDkw3WS8N5qcDQn5cVtPE

Nombre: **Heft** (antes «Workspace Files»). Repo `heft`; prefijo de ajustes y comandos `heft.*`.

Estado: **fases 0 a 6 hechas** (vista «Carpetas», ámbito, comandos y panel con tabla, treemap, uso,
git y hotspots; instalar y probar
con [prepareextension.md](prepareextension.md)). Fase 0 en [docs/fase-0.md](docs/fase-0.md). Fecha: 16-11-2026.
Las capturas son de la v1: valen como referencia visual, con las diferencias de la sección 8.

---

## 1. Qué es

Extensión para **Cursor** (fork de VS Code, misma API de extensiones) que responde a una pregunta:

> **¿Qué pesa en este repo y se está usando?**

Pensada para proyectos web con recursos pesados (modelos `.glb`, audio, texturas) donde el explorador
nativo no enseña ni el peso ni si un recurso sigue referenciado.

Ofrece, sobre un mismo índice de archivos:

1. **Tabla única** de todos los archivos, sin importar la carpeta, ordenable por cualquier columna
   (por defecto Nombre A→Z).
2. **Peso**: árbol de carpetas con tamaño acumulado y **treemap 2D**.
3. **Uso**: quién referencia cada archivo y qué recursos no tienen ningún rastro de uso.
4. **Último cambio en git** de cada archivo, como dato secundario.
5. Todo acotable a una o varias carpetas (el «ámbito»).
6. **Hotspots**, para proyectos sin archivos grandes: tamaño en **líneas** × **frecuencia de cambio**.
   Ahí la pregunta pasa a ser «¿dónde está el código grande que más se toca?».

### Qué no es (recortes respecto a la v1)

- No es un detector de código muerto. Eso lo hace **Knip** (extensión oficial, también en Open VSX);
  aquí solo se integra de forma opcional (fase 6).
- No es un navegador de archivos: para abrir un archivo por nombre ya está Ctrl+P.
- No colorea por commit como modo principal (no escala más allá de unos pocos commits).
- No hay ciudad 3D: descartada (16-11-2026). El treemap 2D cubre lo mismo sin Three.js.

## 2. Interfaz

Dos piezas, cada una con la tecnología que de verdad puede pintarla.

### 2.1 Barra lateral: vista nativa «Carpetas» (TreeView)

Contenedor propio en la barra de actividad. Solo usa lo que el `TreeView` nativo permite:

- Árbol de carpetas y archivos ordenado de mayor a menor tamaño.
- `description` de cada elemento: tamaño acumulado · % dentro de su carpeta padre · nº de archivos
  (ej. `15,3 MB · 51 % · 3 arch.`). Sin barras: el TreeView no las admite.
- **Casilla nativa** (`TreeItem.checkboxState`) en cada carpeta = pertenece al ámbito. Marcar una
  carpeta incluye sus subcarpetas.
  - La API no permite desactivar una casilla: las subcarpetas de una carpeta marcada salen marcadas
    (tooltip «En el ámbito por «src/»») y, si se desmarcan, Heft avisa «Quita primero «src/»» y no
    cambia nada. Se usa `manageCheckboxStateManually` para que el editor no propague solo.
- Clic en un archivo: lo abre (comportamiento nativo, un solo clic). No hay doble clic.
- Botones en la cabecera de la vista: `Abrir panel`, `Todo el repositorio`, `Refrescar`.

### 2.2 Panel «Heft» (un único WebviewPanel, React)

Disposición: barra superior · tabla a la izquierda · treemap a la derecha · detalle abajo.

**Barra superior**
- Chips del ámbito (con ✕) o «Todo el repositorio». Totales: nº de archivos y tamaño.
- Filtro por texto (nombre o ruta).
- Filtros rápidos: Todos · **Sin rastro (n)** · Mencionados (n) · Puntos de entrada · Con cambios sin commit.

**Tabla** (virtualizada; una fila por archivo)

| Columna | Contenido |
|---------|-----------|
| Nombre | cuadrado con el color del modo activo + nombre |
| Carpeta | ruta relativa, gris, truncada |
| Tamaño | bytes legibles + % del ámbito |
| Líneas | nº de líneas en archivos de texto; vacío en binarios |
| Cambios | nº de commits que han tocado el archivo (dentro de `git.since` si está definido) |
| Último cambio | fecha relativa + hash corto; `●` si hay cambios sin commit; «nuevo» si no tiene commits |
| Uso | estado (ver 3.3) + nº de archivos que lo referencian |

- Orden por cualquier columna; por defecto **Nombre A→Z** (`localeCompare`, sin distinguir mayúsculas).
- Clic: selecciona y resalta en el treemap. Enter o botón **Abrir**: abre el archivo.
- Fila desplegable: **Lo usan** (con tipo: `import`, `ruta en string`, `url()`, `src/href`, `mención`)
  y **Usa**. Las referencias desde fuera del ámbito se muestran marcadas «fuera del ámbito».

**Treemap 2D** (`d3-hierarchy`, `treemapSquarify`)
- Anidado por carpetas, cabecera con nombre y tamaño. Clic en cabecera: zoom; migas para volver.
- **Área** (selector): `Bytes` (por defecto) | `Equilibrado` (√bytes, para que el código no desaparezca
  junto a los binarios) | `Líneas` (solo archivos de texto; los binarios no se dibujan).
- **Color** (selector):
  - `Extensión` (por defecto).
  - `Uso`: referenciado / mencionado / sin rastro / punto de entrada / no analizado.
  - `Antigüedad`: 5 tramos calculados por **cuantiles del propio repo**, no por fechas fijas.
  - `Commits recientes`: color solo para los últimos 8 commits; el resto en gris neutro.
  - `Cambios`: escala de un solo tono, de gris (estable) a intenso (muy tocado), por cuantiles del repo.
- Leyenda según el modo; clic en un elemento de la leyenda resalta sus archivos y atenúa el resto.
- Colores con contraste suficiente en tema claro y oscuro (usar variables de tema de VS Code).

**Detalle del archivo seleccionado**
- Ruta, tamaño, % del ámbito, **Abrir**, **Revelar en el explorador**.
- Último commit: hash (clic = copiar completo), mensaje, autor, fecha, **Ver diff** si hay cambios.
- En archivos «sin rastro»: **Ignorar este archivo** y **Mover a la papelera…** (con confirmación;
  nunca borrado automático).

## 3. Reglas de comportamiento

### 3.1 Ámbito
- Es estado de interfaz: se guarda en `workspaceState`, **no** en `.vscode/settings.json`.
- Filtra lo que se **muestra** (tabla, treemap, totales, porcentajes).
- **No** recorta los cálculos: el grafo de referencias y el historial de git se calculan siempre sobre
  todo el repositorio. Un archivo usado solo desde fuera del ámbito **no** es huérfano.

### 3.2 Qué archivos entran
- Con git: `git ls-files` (seguidos) + `git ls-files --others --exclude-standard` (nuevos sin ignorar).
  Así `.gitignore` se respeta exactamente y no hace falta lista de exclusiones propia.
- Conmutador **«Incluir ignorados»** (apagado por defecto): añade `node_modules`, `dist`, etc. solo
  para ver su peso; esos archivos no tienen datos de git ni de uso.
- Sin git: `workspace.findFiles` respetando `files.exclude`; columnas de git vacías.
- Multi-root: la v2 trabaja con **una** carpeta de workspace (se elige si hay varias).

### 3.3 Estados de uso

| Estado | Significado |
|--------|-------------|
| **Referenciado** | Algún archivo apunta a él con una ruta que se resuelve |
| **Mencionado** | Su nombre aparece en algún archivo de texto, pero ninguna ruta se resolvió (cubre rutas montadas en ejecución, como `` `/models/${name}.glb` ``) |
| **Sin rastro** | Ni ruta ni nombre en ningún sitio: candidato a borrar |
| **Punto de entrada** | Se usa desde fuera del grafo; nunca es huérfano |
| **No analizado** | Configuración, documentación, lockfiles |

- El veredicto «sin rastro» solo se da con confianza para **recursos** (modelos, audio, imágenes,
  fuentes, datos). Para **código**, la tabla muestra «sin importadores» como aviso de baja confianza y
  remite a Knip.
- Puntos de entrada automáticos: `index.html`, campos `main`/`module`/`exports`/`bin` de `package.json`,
  configs (`vite.config.*`, `eslint.config.*`, `tailwind.config.*`…), tests y stories (`*.test.*`,
  `*.spec.*`, `*.stories.*`), `*.d.ts`, service workers y el manifest PWA.
- Se **leen como origen** de referencias, aunque no sean candidatos: `index.html`, el manifest PWA
  (iconos), configs como `vite.config.ts` (donde a menudo se declara el manifest), CSS, componentes
  `.vue/.svelte/.astro` y Markdown (imágenes del README).
- Reglas añadidas en la fase 0 (ver [docs/fase-0.md](docs/fase-0.md)):
  - En TS/JS los strings se leen del AST: una ruta en un comentario no es uso.
  - En Markdown solo cuentan enlaces e `<img>` hacia recursos y documentos: citar `src/x.ts` en el
    README no demuestra que el código se use.
  - Las referencias desde scripts de tooling (`scripts/`, `tools/`, `bin/`, otros lenguajes) bajan a
    «mención»: un generador nombra lo que escribe.
  - Las rutas absolutas (`/x.png`) se resuelven contra la carpeta pública más cercana subiendo desde
    el archivo (`public/`, `docs/public/`, `packages/app/public/`).
  - YAML/TOML y las carpetas con punto (`.github/`, `.vscode/`) son configuración.
  - Las menciones buscan el nombre completo y la raíz si tiene 3 letras o más.
- Reglas añadidas tras la revisión de código de las fases 0 y 1:
  - Un JSON en la raíz, o con nombre de herramienta (`biome.json`, `components.json`,
    `renovate.json`, `*.config.json`…), es configuración, no un recurso «sin rastro». El manifest
    PWA sigue siendo recurso y origen de iconos.
  - Los imports de recursos con alias del tsconfig (`@/assets/logo.png`) se resuelven a mano:
    TypeScript no sigue `paths` hacia extensiones que no son suyas.
  - `import.meta.glob` de Vite: lo que casa con el patrón queda «referenciado» (tipo
    `import.meta.glob`). Admite arrays, alias, `{a,b}` y exclusiones con `!`.
  - Límite conocido: un recurso usado solo por código sin importadores sale «referenciado»
    (no hay alcanzabilidad desde los puntos de entrada). Candidato para la fase 4.

### 3.4 Git
- `●` = cambios en el árbol de trabajo **o** en staging. Archivo sin commits = «nuevo».
- Mismo hash = mismo color solo dentro del modo «Commits recientes».

### 3.5 Hotspots
- Vista típica: área `Líneas` + color `Cambios`. Grande e intenso = candidato a dividir o revisar;
  grande y gris = código estable.
- Atajo **«Hotspots»** en la barra superior: aplica esa combinación y ordena la tabla por Cambios.
- «Cambios» cuenta commits, no líneas modificadas. Con `git.since` es «cambios en ese periodo».
- **No se siguen los renombrados**: un archivo renombrado empieza a contar desde cero. Decisión
  consciente para no encarecer el comando de git.
- Lockfiles y archivos generados quedan fuera del cálculo (cambian mucho y no dicen nada).
- Sin git no hay hotspots: el área `Líneas` sigue funcionando, el color `Cambios` se desactiva.

## 4. Implementación

### 4.1 Stack
- TypeScript, API `vscode`. Build con **esbuild**, tres bundles: extensión y worker (Node) y webview
  (navegador, `dist/webview.js` + `dist/webview.css`).
- Webview: React + `d3-hierarchy`. Sin Three.js.
- Análisis de imports con **`typescript@5.9.3` propia**: TypeScript 7 (nativa) ya no expone
  `preProcessFile`, `resolveModuleName` ni `createSourceFile`. No depende de la versión del proyecto.
- Estilo de código: `async/await` en lugar de cadenas `.then/.catch` (el top-level `await` no aplica:
  todo cuelga de `activate()`).
- Empaquetado `.vsix` con `vsce`; instalar con *Extensions: Install from VSIX…*. Comprobar la versión
  base de VS Code que usa Cursor antes de fijar `engines.vscode`.

### 4.2 Arquitectura
- **`core/`**: módulo puro, sin dependencia de `vscode` (entrada: ruta del repo; salida: índice).
  Se puede ejecutar como CLI y probar con tests. Aquí viven el listado, git y el grafo de uso.
- **`extension/`**: `TreeDataProvider` de carpetas, comandos, `WebviewPanel`, vigilancia de cambios.
  - El análisis corre en un **worker** (`worker_threads`), uno por análisis: `runner.ts` lo lanza y
    `worker.ts` ejecuta el núcleo. El bundle de la extensión (`dist/extension.cjs`, ~13 KB) no
    contiene el núcleo ni TypeScript; van en `dist/worker.cjs`. `extension.ts` solo importa tipos
    del núcleo.
  - Un análisis nuevo **cancela** el que esté en curso (se termina el worker).
  - Progreso: barra nativa sobre la vista (`withProgress` con `viewId`, indeterminada) y fase con
    avance en la barra de estado (`uso 1.200/3.006`). Fases: listado, lectura, git, uso, menciones.
  - Resultado en dos tiempos: en el primer análisis el árbol con tamaños aparece al acabar la
    lectura (`onPartial`, índice con `complete: false`); uso y git llegan al final. En un
    reanálisis se mantiene el índice completo anterior hasta tener el nuevo.
  - Durante el primer análisis la vista muestra un texto sobre el árbol (`TreeView.message`) con
    la fase y el avance, y el panel una pantalla de espera con spinner y barra. En un repo grande
    la barra nativa sola no dejaba claro que Heft estaba trabajando.
  - El panel cuelga de los mismos avisos: `panel.ts` crea el webview y pasa mensajes
    (`panel-protocol.ts`). El índice (pesado) solo se manda cuando cambia; ámbito, avance y error
    van en un mensaje de estado aparte. Como el webview se descarga al ocultar la pestaña, no se
    le manda nada hasta que avisa con `ready`.
  - Lo que llega del webview no se da por bueno: solo se abren rutas que están en el índice.
  - Errores del panel a la vista (`webview/errors.tsx`): un fallo al pintar enseña el mensaje y
    la traza con **Reintentar**, **Copiar el error** y **Ver el registro** (nunca una pestaña en
    blanco); uno en ejecución sale en una banda descartable. Los dos se escriben en el registro.
  - El panel se prueba también con DOM (`test/webview-*.test.ts`, jsdom) con un
    `acquireVsCodeApi` fiel al real: su `setState` **devuelve** el estado.
- **`webview/`**: tabla, treemap y detalle. CSP con nonce, recursos con `asWebviewUri`, comunicación
  por `postMessage`, estado (orden, zoom, selección) con `getState/setState`.
- Índice en memoria:
  `Map<path, { size, lines?, ext, commit?, changes, gitState, usage, refsIn, refsOut }>`.

### 4.3 Datos
- **Tamaños**: `fs.stat` sobre la lista de 3.2. `FileSystemWatcher` para actualizar de forma incremental (plan en §10).
- **Git, último commit por archivo**: un único comando sobre todo el repo, sin acotar por carpeta:
  ```bash
  git -c core.quotePath=false log --format='%x00%H%x09%h%x09%an%x09%at%x09%s' --name-only [--since=…]
  ```
  La primera aparición de cada ruta es su último commit, y el **número de apariciones** es su
  recuento de cambios (mismo recorrido, sin coste extra). Se cachea por hash de HEAD: cambiar el
  ámbito no lo recalcula.
- **Líneas**: contar saltos de línea al leer los archivos de texto (ya se leen para el análisis de
  uso). Un archivo es binario si su extensión lo indica o si contiene bytes nulos al principio. Estado de cambios desde la API `vscode.git` (`workingTreeChanges` + `indexChanges`).
- **Uso** (dos pasadas):
  1. *Rutas*: en código TS/JS, `ts.preProcessFile` para los literales de `import`/`require`/`import()`
     y `ts.resolveModuleName` con el `tsconfig`; además, strings con pinta de ruta, `url()` en CSS,
     `src`/`href` en HTML, iconos del manifest, imágenes en Markdown. Resolver contra el directorio del
     archivo y contra la carpeta pública (ajuste, por defecto `public`).
  2. *Menciones*: para cada recurso aún sin referencia, buscar su nombre (con y sin extensión) en los
     archivos de texto. Si aparece: «mencionado».
  Recalcular solo el archivo guardado (grafo incremental, plan en §10).

### 4.4 Comandos y menús
- Paleta: `Heft: Abrir panel`, `Elegir carpetas del ámbito…` (QuickPick múltiple),
  `Todo el repositorio`, `Refrescar`.
- Menú contextual del explorador sobre carpetas: `Añadir al ámbito` · `Limitar ámbito a esta carpeta`.

### 4.5 Ajustes

| Clave | Por defecto | Descripción |
|-------|-------------|-------------|
| `heft.publicDir` | `public` | Carpeta contra la que se resuelven las rutas absolutas (`/models/x.glb`) |
| `heft.git.since` | *(vacío)* | Limitar el historial en repos grandes, p. ej. `1.year` |
| `heft.usage.ignore` | `[]` | Archivos que nunca se marcan «sin rastro» |
| `heft.usage.entryPoints` | `[]` | Puntos de entrada extra además de los automáticos |

## 5. Fases

0. ~~**Validación con un repo real**~~ **Hecha** ([docs/fase-0.md](docs/fase-0.md)): Feos pero majos
   survival (0 falsos; coincide con Knip) y `vitejs/vite` (3.006 archivos en ~2 s; de 21 «sin rastro»
   a 1 real tras corregir 7 causas de falsos positivos).
1. ~~Vista lateral «Carpetas» con tamaños y casillas de ámbito.~~ **Hecha**: más comandos, menú
   contextual del explorador, barra de estado, ajustes y recálculo al cambiar archivos (completo, con
   espera de 1,5 s; el incremental está planificado en §10). Multi-root: solo la primera carpeta.
   Los cambios en archivos ignorados por git (`dist/`, `node_modules/`) no relanzan el análisis.
   El análisis corre en un worker, con progreso y cancelación (§4.2).
2. ~~Panel con la tabla (tamaño, orden, filtro, ámbito).~~ **Hecha**: comando y botón `Abrir panel`,
   chips del ámbito (con ✕), totales, filtro por nombre o ruta (sin tildes ni mayúsculas, varias
   palabras), columnas Nombre, Carpeta y Tamaño (+ % del ámbito), orden por cualquiera, lista
   virtual, teclado (↑ ↓, Re/Av Pág, Inicio/Fin, Enter abre) y botón **Abrir** en la fila
   seleccionada. Orden, filtro y selección se guardan con `getState/setState`. Añadido: aviso y
   pantalla de espera del primer análisis (§4.2). Las demás columnas llegan con sus fases (4, 5, 6).
   Pendiente: el panel no se restaura al recargar la ventana (haría falta un serializador).
3. ~~Treemap 2D enlazado con la tabla (área, color por extensión, zoom).~~ **Hecha**: treemap
   anidado en SVG (`d3-hierarchy`), área `Bytes` | `Equilibrado`, color por extensión (las 9 que más
   pesan; el resto «otros»), leyenda que resalta un grupo, zoom por clic en la cabecera de una
   carpeta con migas, selección enlazada en los dos sentidos y detalle inferior con **Abrir** y
   **Revelar en el explorador**. La tabla lleva el cuadrado de color. El filtro de texto recorta
   también el treemap. Doble clic en un rectángulo abre el archivo. Lo que mide menos de un píxel
   no se dibuja (en `Bytes`, el código junto a binarios grandes: para eso está `Equilibrado`).
   Errores del panel a la vista (§4.2).
4. ~~Uso: columna, estados, fila desplegable, color «Uso», acciones sobre «sin rastro».~~ **Hecha**:
   columna Uso (estado + nº de archivos que lo referencian, ordenable de más a menos sospechoso),
   filtros rápidos Todos · Sin rastro (n) · Mencionados (n) · Puntos de entrada (n), color «Uso» y
   acciones **Ignorar este archivo** (lo añade a `heft.usage.ignore` del workspace) y **Mover a la
   papelera…** (confirmación modal, `useTrash`; la extensión solo acepta archivos que el índice
   da por «sin rastro»). El grafo viaja al panel una arista por referencia, por posición.
   **Cambio respecto al diseño**: «Lo usan» y «Usa» no van en una fila desplegable sino en el
   detalle inferior (dos listas con el tipo y la marca «fuera del ámbito»): sirve igual al
   seleccionar desde el treemap y no complica la lista virtual. Clic en una referencia la
   selecciona; si está fuera del ámbito, la abre. Con el índice a medias el uso sale «Analizando…».
5. ~~Git: columna «Último cambio», colores «Antigüedad» y «Commits recientes», detalle del commit.~~
   **Hecha**: columna (fecha relativa + hash corto, `●`, «nuevo»; ordena con lo nuevo primero y lo
   que no tiene dato al final), filtro rápido «Con cambios sin commit (n)», detalle del commit
   (clic en el hash copia el completo, mensaje, autor, fecha) y **Ver diff** (`git.openChange`) si
   hay cambios. Los commits viajan al panel una sola vez cada uno.
   - «Antigüedad»: hasta 5 tramos por cuantiles de los archivos del ámbito. Un commit que por sí
     solo llena más de un tramo (el inicial, una importación) se queda con uno para él y los
     demás tramos se reparten entre el resto; con cuantiles a secas saldría todo de un color.
   - «Commits recientes»: los 8 últimos entre los que son el último cambio de algún archivo del
     ámbito (un commit cuyos archivos se han vuelto a tocar todos después no aparece).
   - Con todas las columnas la tabla tiene ancho mínimo y se desplaza en horizontal si no cabe.
6. ~~Hotspots: columnas Líneas y Cambios, área «Líneas», color «Cambios», atajo «Hotspots».~~
   **Hecha**: columnas Líneas (vacía en binarios) y Cambios, ordenables de mayor a menor; área
   `Líneas` (los binarios no se dibujan; las cabeceras de carpeta pasan a dar líneas); color
   `Cambios` en un solo tono por cuantiles, con «Sin cambios registrados» y «Generado o lockfile»
   aparte y fuera del cálculo; botón **Hotspots** que aplica las tres cosas. Sin git: el botón y
   los colores de git quedan apagados y el área `Líneas` sigue funcionando. El detalle lleva
   líneas y cambios.
7. Opcional: integración con Knip para código (verificar su salida JSON). La ciudad 3D con Three.js
   se **descarta** (16-11-2026).
8. **Análisis incremental**: planificado en §10, sin código. Es lo siguiente, antes que la fase 7.

Producto mínimo útil = fases 0 a 4. Para proyectos sin archivos grandes, el valor llega en la fase 6.

Ajustes del panel tras probarlo en el editor:
- **Divisor** entre la tabla y el gráfico: se arrastra, se mueve con ← → y vuelve al reparto
  inicial con doble clic o Inicio. Entre el 20 % y el 85 % del ancho; se guarda con el estado.
- Botón **Ocultar gráfico / Mostrar gráfico**: la tabla ocupa todo el panel. «Hotspots» lo vuelve
  a mostrar.
- **Línea de estado** siempre presente y de altura fija bajo los filtros: avance mientras analiza,
  error si falla y, en reposo, «Última actualización: hh:mm:ss». Antes aparecía solo al analizar
  y la tabla saltaba.

### 5.1 Para más adelante (no planificado; decidir tras usar los hotspots en un repo real)

- **Impacto**: nº de archivos que dependen de uno, directa **o indirectamente** (cierre transitivo
  del grafo de referencias). Columna ordenable y modo de color; indica qué es arriesgado tocar.
  Sale del grafo que ya existe. Cuidado con los ciclos de imports al recorrerlo.
- **Cambian juntos**: pares de archivos que aparecen en los mismos commits **sin** referenciarse
  entre sí (acoplamiento oculto). Sale del mismo `git log`. En la fila desplegable: «Suele cambiar
  con…». Riesgo de ruido: descartar commits que tocan muchos archivos (p. ej. más de 20) y exigir
  un mínimo de coincidencias (p. ej. 3) antes de mostrar un par.

## 6. Pendiente de decidir

- Publisher y si se publica en Open VSX o solo `.vsix` para uso propio. Si se publica, comprobar
  antes que el nombre `heft` está libre.
- Umbral de la búsqueda de menciones: nombres muy cortos o genéricos (`icon.png`) darán falsos
  «mencionado».
- Límite de archivos y si el análisis va en un worker (decidir con los datos de la fase 0).
- Si la vista lateral muestra archivos o solo carpetas.
- Qué cuenta como «archivo generado» para excluirlo de los hotspots (lista fija o ajuste).

## 7. Datos de ejemplo del diseño

Proyecto ficticio `kart-game` (24 archivos, ~30 MB), tal como está en el diseño interactivo v2:
`public/models` (circuit.glb 8,4 MB, kart.glb 4,1 MB, trees.glb 2,8 MB), `public/audio`,
`public/textures`, `src/game` (Physics, Track, Kart, Camera), `src/components` (App, HUD, Menu),
`src/styles`, más `index.html` y `src/main.tsx` (nuevo, sin commit; importa `App.tsx`). Seis commits
(`e41d0b7`, `a3f9c21`, `7be04d8`, `5d27c6b`, `1c88e5a`, `90ad3f2`).

- **Sin rastro**: trees.glb (2,8 MB) y drift.mp3 (600 KB); 3,4 MB en total.
- **Mencionado**: grass.png (1,8 MB): `Track.ts` monta su ruta en ejecución. En la v1 era un falso
  huérfano.

El diseño interactivo no incluye los hotspots (líneas y cambios); la extensión sí.

## 8. Capturas de la v1 y qué cambia

| Captura | Sigue valiendo | Cambia en la v2 |
|---------|----------------|-----------------|
| `01-principal-lista-treemap-commit.png` | Treemap, detalle inferior, chips de ámbito | La lista lateral pasa a ser la tabla del panel; el color por defecto es Extensión |
| `02-ambito-selector-carpetas.png` | La idea de casillas por carpeta | Son casillas nativas en la vista «Carpetas» |
| `03-repo-completo-color-extension.png` | Sí (modo por defecto) | — |
| `04-color-antiguedad.png` | El modo | Tramos por cuantiles, no por fechas fijas |
| `05-arbol-por-tamano.png` | Estructura y orden | Sin barras ni colores: tamaño y % en texto |
| `06-ciudad-3d.png` | No | Descartada: no hay ciudad 3D |
| `07-ambito-paleta-y-menu.png` | Sí | Se quita «Abrir treemap de esta carpeta» |
| `08-referencias-huerfanos.png` | Fila desplegable y acciones | Deja de ser pestaña: son columnas y filtros de la tabla; «Huérfano» pasa a «Sin rastro» / «Mencionado» |

## 9. Resumen de cambios v1 → v2

- Foco: de «visión general del workspace» a «qué pesa y si se usa».
- Tres listas (A→Z, árbol, referencias) → una tabla + un árbol nativo.
- Barra lateral construible con TreeView nativo; todo lo gráfico va al panel.
- Ámbito en `workspaceState` y solo como filtro de vista; cálculos siempre sobre el repo entero.
- Lista de archivos desde `git ls-files`; desaparece `workspaceFiles.exclude`.
- Huérfanos con tres niveles de confianza; código delegado en Knip.
- Color por commit limitado a los últimos 8; antigüedad por cuantiles; área «Equilibrado».
- Definidos: archivos nuevos, staging, repos sin git, multi-root.
- Git pasa de la fase 4 a la 5 y deja de ser requisito de las anteriores; se añade la fase 0.
- Añadido después: hotspots (líneas × cambios) como fase 6; Impacto y Cambian juntos apuntados
  para más adelante (5.1).

## 10. Análisis incremental (plan)

Estado: **planificado, sin código**. Es el siguiente trabajo. Fecha del plan: 16-11-2026.

### 10.1 Problema

Hoy cualquier cambio en disco relanza el análisis completo tras 1,5 s: listar, leer todos los
archivos, `git log` de todo el historial, extraer referencias de cada origen y buscar menciones.
Además el worker vive un solo análisis y se destruye, así que no queda nada que reutilizar.
En un repo pequeño no se nota; en un monorepo, guardar un archivo cuesta lo mismo que abrirlo.

### 10.2 Objetivo y criterio de aceptación

- Guardar un archivo actualiza el índice recalculando **solo lo que ese archivo puede cambiar**.
- **Equivalencia**: tras cualquier secuencia de cambios, el índice incremental es idéntico (salvo
  tiempos) al de un análisis completo desde cero. Es el criterio que manda y va en un test:
  ediciones aleatorias sobre el proyecto de prueba, comparando contra `buildIndex`.
- Si algo no encaja en el camino incremental, se cae al análisis completo. Nunca se enseña un dato
  viejo a sabiendas, y **Refrescar** es siempre un análisis completo.
- Objetivo de tiempo, a confirmar en el paso I0: guardar un archivo en `vitejs/vite` por debajo de
  100 ms (hoy ~2 s).

### 10.3 Qué depende de qué

| Cambio | Qué invalida |
|--------|--------------|
| Contenido de un archivo existente | Su tamaño, líneas y `●`; las referencias que **salen** de él; las menciones que él aporta; el estado de uso de los archivos a los que apuntaba o apunta |
| Archivo creado | Lo anterior, más: imports sin resolver de otros archivos que ahora sí resuelven, patrones `import.meta.glob` que lo incluyen y, si es un recurso, su búsqueda de menciones |
| Archivo borrado | Sus referencias de salida; las de entrada (esos orígenes pasan a tener un import sin resolver); si un recurso pierde su última referencia, hay que buscarle menciones |
| Commit nuevo sobre el mismo historial | Último commit y recuento de cambios de los archivos de esos commits; `●` |
| Cambio de rama, rebase, amend, reset | Todo el historial (no el uso, salvo los archivos que cambien en disco) |
| `tsconfig*`/`jsconfig*`, `package.json`, `.gitignore`, ajustes `heft.*`, aparece o desaparece una carpeta pública | Todo: cambian la resolución, los puntos de entrada o la lista de archivos |

### 10.4 Diseño

**Estado que se conserva** (`IndexState`, en el núcleo, sin `vscode`):
- El mapa de archivos y, por cada origen, su **extracción**: lo que el archivo dice (imports,
  strings con pinta de ruta, `url()`, `src/href`, enlaces, patrones glob), separado de **a qué
  resuelve**. Extraer es lo caro (AST de TypeScript); resolver es barato y depende del conjunto
  de archivos.
- Las referencias por origen y el índice inverso (quién apunta a cada archivo).
- Los imports relativos sin resolver, indexados por el último tramo de la ruta, para saber a qué
  orígenes puede afectar un archivo nuevo sin recorrerlos todos.
- El historial de git y el `HEAD` con el que se leyó.
- **No** se conservan los textos: en un monorepo serían cientos de MB. Las menciones de un recurso
  que se queda sin referencias se buscan releyendo el disco (caso raro). A confirmar en I0.

**Uso**: separar `analyzeUsage` en extraer → resolver → menciones, y aplicar según 10.3:
- Contenido: re-extraer y re-resolver ese archivo; quitar sus menciones y volver a buscarlas solo
  en su texto (un único recorrido con todos los recursos pendientes); recalcular el estado de uso
  de los destinos que ganan o pierden una referencia.
- Las menciones solo existen para recursos sin referencia directa, igual que hoy: si un recurso
  gana una, se quitan sus menciones; si pierde la última, se le buscan en todo el repo.

**Git**:
- `git status --porcelain` acotado a las rutas del lote.
- `HEAD` avanza y el anterior es ancestro (`git merge-base --is-ancestor`): `git log
  viejo..nuevo --name-only` y sumar. En cualquier otro caso, releer el historial entero (solo git).
- Con `heft.git.since` la ventana se desplaza y los recuentos no se pueden restar: se relee el
  historial en cada cambio de `HEAD` (ya está acotado por `since`).

**Worker y extensión**:
- El worker pasa a ser **persistente** (uno por carpeta analizada) y guarda el `IndexState`.
  Mensajes: `build` (completo), `apply` (lote de cambios), `dispose`.
- La extensión deja de programar «un análisis» y acumula **rutas con su tipo** (creado, cambiado,
  borrado, git). Espera corta (300 ms) y un lote cada vez; lo que llegue mientras se aplica uno
  va al siguiente.
- Cancelar un análisis completo sigue siendo terminar el worker (se pierde el estado, que de
  todos modos se iba a rehacer). Un lote incremental no se cancela: es corto.
- El worker sigue devolviendo el índice entero; mandar solo las diferencias al panel se decide
  midiendo (paso I6).

**Caída al análisis completo**: primer análisis; carpeta sin git; más de 50 rutas en un lote
(renombrar una carpeta, cambiar de rama, `npm install`); cualquier archivo de la última fila de
10.3; error durante un lote; **Refrescar**.

**Lo que ve el usuario**: la línea de estado del panel dice qué se hizo («Actualizado: 2
archivos · 10:03:09» o «Análisis completo · …») y el registro lleva una línea por lote con sus
tiempos.

### 10.5 Pasos (cada uno, un PR)

- **I0 · Medir.** `--profile` en el CLI: tiempo de extraer, resolver, menciones, `git status`,
  `git log` y de pasar el índice del worker a la extensión y al panel; memoria con y sin textos.
  Sobre `vitejs/vite` y el monorepo de trabajo. Fija los umbrales de 10.4 y decide si I6 hace falta.
- **I1 · Separar sin cambiar nada.** `analyzeUsage` en extraer, resolver y menciones; `IndexState`
  con `build()`. Los tests actuales siguen pasando tal cual.
- **I2 · Contenido.** `IndexState.apply()` para archivos existentes que cambian, con el test de
  equivalencia. Todavía sin conectar a la extensión.
- **I3 · Crear, borrar y renombrar**, y las caídas al análisis completo.
- **I4 · Git.** Avance de `HEAD` incremental; lo demás, relectura del historial.
- **I5 · Conectar.** Worker persistente, lotes de rutas en la extensión, espera de 300 ms, línea de
  estado y registro. A partir de aquí lo nota el usuario.
- **I6 · Solo si I0 lo pide.** Mandar diferencias al panel en vez del índice entero.

### 10.6 Riesgos y límites aceptados

- **Sombra**: crear `foo.ts` junto a un `foo.js` ya importado cambia a cuál resuelve el import y el
  camino incremental no lo ve (solo revisa imports sin resolver). Se corrige en el siguiente
  análisis completo. Si el test de equivalencia lo destapa a menudo, re-resolver también los
  imports cuyo destino comparte nombre con el archivo nuevo.
- **Windows**: el vigilante puede dar las rutas con otra capitalización; se normalizan contra las
  rutas conocidas del índice antes de aplicar nada.
- **Memoria** del worker persistente: acotada al no guardar textos; se mide en I0.
- **Deriva**: el test de equivalencia es la defensa. En desarrollo, un ajuste oculto
  (`heft.debug.verifyIncremental`) que tras cada lote lanza el análisis completo y registra las
  diferencias.
- El incremental no arregla el primer análisis: ese sigue costando lo mismo.
