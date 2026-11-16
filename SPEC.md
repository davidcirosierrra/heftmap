# Heft — especificación v2 (auditor de peso y uso)

> **Para retomar en otra conversación:** adjunta este archivo (y la carpeta `docs/capturas-v1/`) y di
> «Seguimos con la extensión Heft según SPEC.md v2».
> Diseño interactivo v2: https://claude.ai/artifact/SM6p8UJHZht4bQe87xk3Ph
> Diseño v1 (histórico): https://claude.ai/artifact/CHDkw3WS8N5qcDQn5cVtPE

Nombre: **Heft** (antes «Workspace Files»). Repo `heft`; prefijo de ajustes y comandos `heft.*`.

Estado: **fase 2 hecha** (vista «Carpetas», ámbito, comandos y panel con la tabla; instalar y probar
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
- La ciudad 3D pasa a ser un extra opcional, fuera del producto mínimo.

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
- Webview: React + `d3-hierarchy`. Sin Three.js en el producto mínimo.
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
- **`webview/`**: tabla, treemap y detalle. CSP con nonce, recursos con `asWebviewUri`, comunicación
  por `postMessage`, estado (orden, zoom, selección) con `getState/setState`.
- Índice en memoria:
  `Map<path, { size, lines?, ext, commit?, changes, gitState, usage, refsIn, refsOut }>`.

### 4.3 Datos
- **Tamaños**: `fs.stat` sobre la lista de 3.2. `FileSystemWatcher` para actualizar de forma incremental.
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
  Recalcular solo el archivo guardado (grafo incremental).

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
   espera de 1,5 s; el incremental queda pendiente). Multi-root: solo la primera carpeta.
   Los cambios en archivos ignorados por git (`dist/`, `node_modules/`) no relanzan el análisis.
   El análisis corre en un worker, con progreso y cancelación (§4.2).
2. ~~Panel con la tabla (tamaño, orden, filtro, ámbito).~~ **Hecha**: comando y botón `Abrir panel`,
   chips del ámbito (con ✕), totales, filtro por nombre o ruta (sin tildes ni mayúsculas, varias
   palabras), columnas Nombre, Carpeta y Tamaño (+ % del ámbito), orden por cualquiera, lista
   virtual, teclado (↑ ↓, Re/Av Pág, Inicio/Fin, Enter abre) y botón **Abrir** en la fila
   seleccionada. Orden, filtro y selección se guardan con `getState/setState`. Añadido: aviso y
   pantalla de espera del primer análisis (§4.2). Las demás columnas llegan con sus fases (4, 5, 6).
   Pendiente: el panel no se restaura al recargar la ventana (haría falta un serializador).
3. Treemap 2D enlazado con la tabla (área, color por extensión, zoom).
4. Uso: columna, estados, fila desplegable, color «Uso», acciones sobre «sin rastro».
5. Git: columna «Último cambio», colores «Antigüedad» y «Commits recientes», detalle del commit.
6. Hotspots: columnas Líneas y Cambios, área «Líneas», color «Cambios», atajo «Hotspots».
7. Opcionales: integración con Knip para código (verificar su salida JSON), ciudad 3D con Three.js.

Producto mínimo útil = fases 0 a 4. Para proyectos sin archivos grandes, el valor llega en la fase 6.

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

El diseño interactivo todavía no incluye los hotspots (líneas y cambios).

## 8. Capturas de la v1 y qué cambia

| Captura | Sigue valiendo | Cambia en la v2 |
|---------|----------------|-----------------|
| `01-principal-lista-treemap-commit.png` | Treemap, detalle inferior, chips de ámbito | La lista lateral pasa a ser la tabla del panel; el color por defecto es Extensión |
| `02-ambito-selector-carpetas.png` | La idea de casillas por carpeta | Son casillas nativas en la vista «Carpetas» |
| `03-repo-completo-color-extension.png` | Sí (modo por defecto) | — |
| `04-color-antiguedad.png` | El modo | Tramos por cuantiles, no por fechas fijas |
| `05-arbol-por-tamano.png` | Estructura y orden | Sin barras ni colores: tamaño y % en texto |
| `06-ciudad-3d.png` | Solo como opcional (fase 6) | Fuera del producto mínimo |
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
