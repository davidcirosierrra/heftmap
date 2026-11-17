# Preparar y probar Heftmap en Cursor

Guía para instalar la extensión y comprobar las **fases 1 a 6** (vista «Carpetas», ámbito y panel
con tabla, treemap, uso, git y hotspots).
Funciona igual en VS Code.

## 1. Requisitos

- Node.js 20 o superior (`node --version`).
- Git en el `PATH`: Heftmap lo usa para listar archivos y leer el historial.
- Cursor (o VS Code 1.85 o superior).

## 2. Preparar el repo

```bash
git clone https://github.com/davidcirosierrra/Heft.git
cd Heft
npm install
npm test                        # núcleo, ámbito, árbol, panel (lógica y DOM) y humo de la extensión
```

## 3. Dos formas de probarla

### A. Instalar el `.vsix` (como la usarás de verdad)

```bash
npm run package                 # genera heftmap.vsix (~1,8 MB)
```

En Cursor:

1. `Ctrl+Shift+P` (`Cmd+Shift+P` en Mac) → **Extensions: Install from VSIX…**
2. Elige `heftmap.vsix`.
3. Recarga la ventana si te lo pide (**Developer: Reload Window**).

O desde la terminal:

```bash
cursor --install-extension heftmap.vsix
```

Para actualizar: vuelve a ejecutar `npm run package` e instala el `.vsix` nuevo encima.
Un `.vsix` instalado a mano **no se actualiza solo**.

Para desinstalar: panel de extensiones → Heftmap → **Uninstall**, o
`cursor --uninstall-extension notime-labs.heftmap`.

### B. Modo desarrollo con F5 (para depurar)

1. Abre la carpeta `Heftmap` en Cursor.
2. Pulsa **F5** (o *Run and Debug* → **Heftmap: probar la extensión**).
3. Se abre otra ventana, el *Extension Development Host*, con Heftmap cargada desde el código.
   Abre ahí el proyecto que quieras analizar (**File → Open Folder…**).
4. Tras cambiar código: `Ctrl+R` en la ventana de pruebas para recargar (la tarea previa recompila).

Si F5 no hace nada, ejecuta antes `npm run build:ext` y comprueba que existen `dist/extension.cjs`,
`dist/worker.cjs` y `dist/webview.js`.

## 4. Proyecto de prueba

Usa un repo con git y recursos, por ejemplo Feos pero majos:

```bash
git clone https://github.com/davidcirosierrra/FEOS_PERO_MAJOS_SURVIVAL.git
```

Ábrelo en Cursor (con el `.vsix` instalado) o en la ventana de F5.

## 5. Qué comprobar (fase 1)

Marca cada punto. Si algo falla, abre **Heftmap: Mostrar registro** (`Ctrl+Shift+P`) y copia lo que salga.

**Arranque**
- [ ] Aparece un icono nuevo en la barra de actividad (un cuadrado dividido, tipo treemap).
- [ ] En la barra de estado, abajo a la izquierda: `Heftmap: Todo el repositorio · N archivos · X MB`.
      Mientras analiza muestra un icono girando y la fase (`leyendo 40/79`, `uso 12/30`…).
- [ ] Mientras analiza, una barra de progreso fina recorre la parte superior de la vista «Carpetas».
- [ ] En un repo grande, antes de que aparezca el árbol la vista muestra el texto «Analizando el
      repositorio (leyendo 1.200/3.006). En repos grandes puede tardar un poco.»; con el árbol ya
      visible cambia a «Tamaños listos. Falta el uso y el historial de git (…)» y desaparece al acabar.
- [ ] En un repo grande, el árbol con tamaños aparece antes de que termine el análisis; hasta
      entonces el tooltip de un archivo dice «Analizando uso y git…».
- [ ] El editor no se queda parado mientras Heftmap analiza (escribe en un archivo durante el análisis).
- [ ] En el registro (*Output → Heftmap*) sale una línea `Índice (inicio)` con los tiempos.

**Vista «Carpetas»**
- [ ] Carpetas y archivos ordenados de mayor a menor tamaño.
- [ ] Cada elemento muestra una barra de peso, el % de su carpeta padre, el tamaño y, en carpetas, el
      nº de archivos (ej. `█████▏ 51 % · 15,3 MB · 3 arch.`). Los iconos del tema siguen ahí.
- [ ] El nombre de lo que más pesa en cada carpeta sale en color (rojo ≥ 50 %, naranja ≥ 20 %,
      amarillo ≥ 10 %). En el explorador nativo y en las pestañas, esos archivos **no** cambian de color.
- [ ] Junto al título de la vista: `Todo el repositorio · 3,2 MB · 74 archivos` (o el ámbito elegido).
- [ ] Iconos de carpeta y de archivo según tu tema de iconos.
- [ ] Un clic en un archivo lo abre.
- [ ] Al pasar el ratón por una carpeta `__tests__` o un archivo `[id].tsx`: la ruta se lee tal cual.
- [ ] Al pasar el ratón por un archivo: líneas, estado de uso (Referenciado, Sin rastro…),
      último commit y nº de cambios.
- [ ] Un archivo con cambios sin guardar en git muestra `●` al final.
- [ ] Botón «contraer todo» en la cabecera de la vista.

**Ámbito con casillas**
- [ ] Marca la casilla de una carpeta: la descripción de la vista y la barra de estado cambian
      (en Feos pero majos: `Heftmap: src · 47 archivos · 339 KB`).
- [ ] Sus subcarpetas aparecen marcadas; el tooltip de la casilla dice «En el ámbito por «src/»».
- [ ] Desmarcar una subcarpeta así muestra un aviso («Quita primero «src/»») y no cambia nada.
- [ ] Marca una segunda carpeta: el ámbito pasa a `public + src`.
- [ ] Cierra y vuelve a abrir Cursor: el ámbito se mantiene (se guarda por workspace, no en
      `.vscode/settings.json`).

**Comandos y menús**
- [ ] Botón del embudo en la cabecera (o `Heftmap: Elegir carpetas del ámbito…`): lista de carpetas
      con casillas; las del ámbito vienen marcadas.
- [ ] Botón «limpiar» (o `Heftmap: Todo el repositorio`): vuelve a `Todo el repositorio`.
- [ ] Clic en la barra de estado: abre el selector de carpetas.
- [ ] Explorador nativo → clic derecho en una carpeta → **Añadir al ámbito de Heftmap**.
- [ ] Selecciona varias carpetas en el explorador (`Ctrl`+clic) → clic derecho → **Añadir…**: se añaden todas.
- [ ] Clic derecho → **Limitar el ámbito de Heftmap a esta carpeta**: el ámbito queda solo en esa.
- [ ] En la vista de Heftmap, clic derecho en una carpeta → **Limitar el ámbito…** y **Revelar en el explorador**.

**Actualización**
- [ ] Crea o borra un archivo: en 1–2 s la vista se actualiza sola.
- [ ] Lanza un build del proyecto (escribe en `dist/`, ignorado por git): en el registro **no** aparece
      un `Índice (cambios en disco)` nuevo.
- [ ] Haz un commit: el tooltip del archivo muestra el commit nuevo.
- [ ] Cambia un ajuste `heftmap.*` (*Settings → Heftmap*): se vuelve a analizar.
- [ ] Botón «refrescar» de la cabecera: vuelve a analizar.

## 6. Qué comprobar (fases 2 a 6: panel)

**Abrir**
- [ ] Botón de la tabla en la cabecera de la vista «Carpetas», o `Heftmap: Abrir panel` en la paleta:
      se abre una pestaña «Heftmap».
- [ ] Pulsarlo otra vez no abre una segunda pestaña: trae la que hay al frente.
- [ ] Recarga la ventana con un repo grande abierto y abre el panel enseguida: pantalla de espera
      con spinner, «Analizando el repositorio…», la fase con su avance y una barra. La tabla
      aparece sola en cuanto hay tamaños, con una línea «Tamaños listos. Falta el uso…» hasta que acaba.

**Tabla**
- [ ] Una fila por archivo, sin importar la carpeta, ordenada por Nombre A→Z (sin distinguir mayúsculas).
- [ ] Columnas Nombre, Carpeta (gris) y Tamaño con el % del ámbito.
- [ ] Clic en una cabecera ordena; otro clic invierte. Tamaño empieza de mayor a menor.
- [ ] En un repo de miles de archivos el desplazamiento va fluido.
- [ ] Clic en una fila la selecciona y aparece el botón **Abrir**; con el foco en la tabla, `↑` `↓`,
      `Re Pág`/`Av Pág`, `Inicio`/`Fin` mueven la selección y `Enter` abre el archivo.
- [ ] Filtro: `glb`, una carpeta (`src/game`), dos palabras (`game kart`), sin tildes (`camara`).
      Los totales pasan a «n de m archivos · tamaño».
- [ ] Los colores siguen el tema: prueba uno claro y uno oscuro.

**Ámbito**
- [ ] Sin ámbito: chip «Todo el repositorio» y totales del repo entero.
- [ ] Marca una carpeta en la vista «Carpetas»: aparece su chip, la tabla se queda con sus archivos
      y los % pasan a ser sobre el ámbito.
- [ ] La ✕ de un chip quita esa carpeta (y se desmarca su casilla en la vista).
- [ ] «Cambiar ámbito…» abre el selector de carpetas.

**Treemap (fase 3)**
- [ ] A la derecha de la tabla, un treemap anidado por carpetas con cabecera (nombre y tamaño).
- [ ] Clic en un rectángulo: se selecciona y la tabla se desplaza hasta su fila. Y al revés: clic en
      una fila marca su rectángulo con un borde. Doble clic en un rectángulo abre el archivo.
- [ ] Abajo, el detalle: ruta, tamaño, % del ámbito, **Abrir** y **Revelar en el explorador**.
- [ ] Clic en la cabecera de una carpeta: amplía. Las migas de arriba vuelven atrás.
- [ ] Área `Equilibrado`: el código deja de desaparecer junto a los binarios.
- [ ] Leyenda: clic en una extensión resalta sus archivos y atenúa el resto; otro clic lo quita.
- [ ] La tabla lleva un cuadrado con el color de cada archivo.
- [ ] El filtro de texto y el ámbito recortan también el treemap.
- [ ] Estrecha el panel: por debajo de ~760 px el treemap pasa debajo de la tabla.

**Uso (fase 4)**
- [ ] Columna **Uso** con el estado y, si los hay, cuántos archivos lo referencian. Ordenar por ella
      pone primero «Sin rastro».
- [ ] Filtros rápidos con recuento: `Sin rastro`, `Mencionados`, `Puntos de entrada`. Recortan tabla y
      treemap. En Feos pero majos los tres primeros recuentos deberían cuadrar con el CLI.
- [ ] Color `Uso` en el treemap: leyenda por estados; clic en «Sin rastro» los resalta.
- [ ] Selecciona un archivo referenciado: abajo salen **Lo usan** y **Usa** con el tipo (`import`,
      `ruta en string`, `mención`…). Clic en uno lo selecciona.
- [ ] Con un ámbito puesto, las referencias de fuera llevan la marca «fuera del ámbito» (y el clic
      las abre). Un archivo usado solo desde fuera del ámbito **no** sale como «sin rastro».
- [ ] En un archivo «sin rastro»: **Ignorar este archivo** lo añade a `heftmap.usage.ignore` (mira
      `.vscode/settings.json`) y tras el reanálisis pasa a «Excepción».
- [ ] **Mover a la papelera…** pide confirmación; al aceptar, el archivo va a la papelera del sistema
      (recuperable) y desaparece de la tabla. Cancelar no hace nada.
- [ ] Durante el primer análisis de un repo grande la columna dice «Analizando…» y los filtros
      rápidos están apagados.

**Git (fase 5)**
- [ ] Columna **Último cambio**: fecha relativa y hash corto. Ordenar por ella pone lo más reciente arriba.
- [ ] Modifica un archivo sin hacer commit: aparece `●` en su fila y entra en el filtro rápido
      `Con cambios sin commit`. Un archivo recién creado dice «nuevo».
- [ ] Detalle: hash, mensaje, autor y fecha del último commit. Clic en el hash: copia el hash
      completo (pégalo para comprobarlo). Con cambios sin commit aparece **Ver diff**, que abre el
      diff del editor.
- [ ] Color `Antigüedad`: hasta 5 tramos, del más reciente (rojo) al más antiguo (azul), calculados
      con las fechas del propio repo. La leyenda dice qué periodo cubre cada uno.
- [ ] Color `Commits recientes`: solo los 8 últimos commits tienen color; el resto, gris. La leyenda
      lleva hash y mensaje; clic en uno resalta lo que tocó.
- [ ] En una carpeta sin git: la columna muestra `—` y el filtro de cambios está apagado.

**Hotspots (fase 6)**
- [ ] Columnas **Líneas** (vacía en binarios) y **Cambios** (nº de commits que tocan el archivo).
- [ ] Botón **Hotspots** (a la derecha de los filtros rápidos): el treemap pasa a área `Líneas` y
      color `Cambios`, y la tabla se ordena por Cambios. Grande e intenso = candidato a dividir o
      revisar; grande y gris = código estable. En Feos pero majos deberían destacar
      `src/index.css` y `src/game/store.ts`.
- [ ] En área `Líneas` los binarios desaparecen del treemap y las cabeceras de carpeta dan líneas.
- [ ] `package-lock.json` sale en gris oscuro («Generado o lockfile») aunque tenga muchos cambios.
- [ ] La leyenda de `Cambios` da los tramos (`12 o más cambios`, `5–11`…); clic resalta uno.
- [ ] Con `heftmap.git.since` = `1.month`, los cambios cuentan solo ese periodo.
- [ ] En una carpeta sin git: el botón Hotspots y los colores de git están apagados; `Líneas` funciona.
- [ ] Con el panel estrecho la tabla se desplaza en horizontal en vez de aplastar las columnas.

**Idiomas**
- [ ] Con el editor en castellano, todo sale en castellano (panel, vista, barra de estado, avisos,
      comandos de la paleta y ajustes).
- [ ] Ajuste `Heftmap: Language` = `English`: el panel y la vista pasan a inglés al momento, sin
      reanalizar. Los nombres de los comandos y ajustes siguen en el idioma del editor (VS Code no
      deja cambiarlos por extensión).
- [ ] `Euskara`: textos en euskera, números `1,5 MB`, porcentajes `% 51`, fechas `2026/11/12`.
- [ ] Cambia el idioma del editor (*Configure Display Language*) con el ajuste en `auto`: tras
      reiniciar, todo sigue al editor (inglés si no es castellano ni euskera).

**Modo restringido**
- [ ] Abre una carpeta y elige «No confío» (o *Workspaces: Manage Workspace Trust* → no confiar):
      Heftmap muestra tamaños y uso, la vista dice «Modo restringido: se analiza sin git…» y no hay
      columnas de git con datos.
- [ ] Confía en la carpeta: se reanaliza sola y aparecen el historial y los cambios.

**Reparto y estado**
- [ ] Arrastra la barra entre la tabla y el treemap: cambia el ancho y el treemap se redibuja. Doble
      clic la devuelve a su sitio. Con el foco en ella, `←` `→` también la mueven.
- [ ] **Ocultar gráfico** (junto a Hotspots): la tabla ocupa todo. **Mostrar gráfico** lo recupera.
- [ ] Bajo los filtros hay siempre una línea: «Última actualización: hh:mm:ss». Guarda un archivo:
      pasa a «Actualizando: …» y vuelve con la hora nueva, sin que la tabla se mueva.
- [ ] Cambia a otra pestaña y vuelve: se conservan orden, filtro, selección, área, color, zoom,
      el ancho de la tabla y si el gráfico está oculto.
- [ ] Crea o borra un archivo: la tabla se actualiza sola; mientras, arriba dice «Actualizando: …».

## 7. Limitaciones conocidas

- «Lo usan» y «Usa» están en el detalle inferior, no en una fila desplegable.
- Al recargar la ventana el panel se cierra; hay que volver a abrirlo.
- En un workspace con **varias carpetas raíz**, Heftmap analiza solo la primera (queda anotado en el registro).
- El árbol siempre muestra el repo entero; el ámbito se ve con las casillas.
- Cada cambio en disco vuelve a analizar todo el repo (con espera de 1,5 s), en segundo plano y
  cancelando el análisis anterior si seguía en curso. El análisis incremental está planificado (SPEC §10).

## 8. Si algo falla

| Síntoma | Qué mirar |
|---------|-----------|
| Aviso «Heftmap: error interno en …» | Es un fallo de Heftmap. Pulsa **Copiar informe** (o `Heftmap: Copiar informe de errores`) y pégalo en una incidencia. El registro completo está en *Output → Heftmap* y en disco: *Developer: Open Extension Logs Folder*. |
| No aparece el icono de Heftmap | *Extensions*: ¿está Heftmap instalada y activada? Recarga la ventana. |
| La vista sale vacía | ¿Tienes una carpeta abierta? Mira **Heftmap: Mostrar registro**. |
| «No se pudo analizar el repositorio» | El mensaje completo está en el registro. Si menciona `worker.cjs`, el `.vsix` está incompleto: vuelve a ejecutar `npm run package`. |
| No hay datos de git (commits, `●`) | Si `git` no está en el `PATH`, Heftmap analiza sin git y lo avisa en el registro (`aviso: No se encuentra «git»…`). |
| `Install from VSIX` falla | Comprueba la versión: Heftmap pide VS Code ≥ 1.85 (*Help → About*). |
| El panel enseña «El panel de Heftmap ha fallado» o una banda roja | Es un error del propio panel: pulsa **Copiar el error** (o **Ver el registro**) y pásalo. **Reintentar** vuelve a pintar. |
| El panel se abre en blanco | Falta `dist/webview.js` o `dist/webview.css` en el `.vsix`: vuelve a ejecutar `npm run package`. Mira también *Developer: Open Webview Developer Tools*. |
| No hay casillas en las carpetas | Versión del editor demasiado antigua: las casillas en vistas existen desde VS Code 1.80. |

Para cualquier fallo, lo más útil es el texto del registro y, si es visual, una captura.
