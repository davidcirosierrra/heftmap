# Preparar y probar Heft en Cursor

Guía para instalar la extensión y comprobar la **fase 1** (vista «Carpetas» y ámbito).
Funciona igual en VS Code.

## 1. Requisitos

- Node.js 20 o superior (`node --version`).
- Git en el `PATH`: Heft lo usa para listar archivos y leer el historial.
- Cursor (o VS Code 1.85 o superior).

## 2. Preparar el repo

```bash
git clone https://github.com/davidcirosierrra/Heft.git
cd Heft
npm install
npm test                        # 48 tests: núcleo, ámbito, árbol y humo de la extensión
```

## 3. Dos formas de probarla

### A. Instalar el `.vsix` (como la usarás de verdad)

```bash
npm run package                 # genera heft.vsix (~1 MB)
```

En Cursor:

1. `Ctrl+Shift+P` (`Cmd+Shift+P` en Mac) → **Extensions: Install from VSIX…**
2. Elige `heft.vsix`.
3. Recarga la ventana si te lo pide (**Developer: Reload Window**).

O desde la terminal:

```bash
cursor --install-extension heft.vsix
```

Para actualizar: vuelve a ejecutar `npm run package` e instala el `.vsix` nuevo encima.
Un `.vsix` instalado a mano **no se actualiza solo**.

Para desinstalar: panel de extensiones → Heft → **Uninstall**, o
`cursor --uninstall-extension davidcirosierrra.heft`.

### B. Modo desarrollo con F5 (para depurar)

1. Abre la carpeta `Heft` en Cursor.
2. Pulsa **F5** (o *Run and Debug* → **Heft: probar la extensión**).
3. Se abre otra ventana, el *Extension Development Host*, con Heft cargada desde el código.
   Abre ahí el proyecto que quieras analizar (**File → Open Folder…**).
4. Tras cambiar código: `Ctrl+R` en la ventana de pruebas para recargar (la tarea previa recompila).

Si F5 no hace nada, ejecuta antes `npm run build:ext` y comprueba que existe `dist/extension.cjs`.

## 4. Proyecto de prueba

Usa un repo con git y recursos, por ejemplo Feos pero majos:

```bash
git clone https://github.com/davidcirosierrra/FEOS_PERO_MAJOS_SURVIVAL.git
```

Ábrelo en Cursor (con el `.vsix` instalado) o en la ventana de F5.

## 5. Qué comprobar (fase 1)

Marca cada punto. Si algo falla, abre **Heft: Mostrar registro** (`Ctrl+Shift+P`) y copia lo que salga.

**Arranque**
- [ ] Aparece un icono nuevo en la barra de actividad (un cuadrado dividido, tipo treemap).
- [ ] En la barra de estado, abajo a la izquierda: `Heft: Todo el repositorio · N archivos · X MB`.
      Mientras analiza muestra un icono girando.
- [ ] En el registro (*Output → Heft*) sale una línea `Índice (inicio)` con los tiempos.

**Vista «Carpetas»**
- [ ] Carpetas y archivos ordenados de mayor a menor tamaño.
- [ ] Cada carpeta muestra `tamaño · % de su carpeta padre · nº de archivos` (ej. `15,3 MB · 51 % · 3 arch.`).
- [ ] Iconos de carpeta y de archivo según tu tema de iconos.
- [ ] Un clic en un archivo lo abre.
- [ ] Al pasar el ratón por una carpeta `__tests__` o un archivo `[id].tsx`: la ruta se lee tal cual.
- [ ] Al pasar el ratón por un archivo: líneas, estado de uso (Referenciado, Sin rastro…),
      último commit y nº de cambios.
- [ ] Un archivo con cambios sin guardar en git muestra `●` al final.
- [ ] Botón «contraer todo» en la cabecera de la vista.

**Ámbito con casillas**
- [ ] Marca la casilla de una carpeta: la descripción de la vista y la barra de estado cambian
      (en Feos pero majos: `Heft: src · 47 archivos · 339 KB`).
- [ ] Sus subcarpetas aparecen marcadas; el tooltip de la casilla dice «En el ámbito por «src/»».
- [ ] Desmarcar una subcarpeta así muestra un aviso («Quita primero «src/»») y no cambia nada.
- [ ] Marca una segunda carpeta: el ámbito pasa a `public + src`.
- [ ] Cierra y vuelve a abrir Cursor: el ámbito se mantiene (se guarda por workspace, no en
      `.vscode/settings.json`).

**Comandos y menús**
- [ ] Botón del embudo en la cabecera (o `Heft: Elegir carpetas del ámbito…`): lista de carpetas
      con casillas; las del ámbito vienen marcadas.
- [ ] Botón «limpiar» (o `Heft: Todo el repositorio`): vuelve a `Todo el repositorio`.
- [ ] Clic en la barra de estado: abre el selector de carpetas.
- [ ] Explorador nativo → clic derecho en una carpeta → **Añadir al ámbito de Heft**.
- [ ] Selecciona varias carpetas en el explorador (`Ctrl`+clic) → clic derecho → **Añadir…**: se añaden todas.
- [ ] Clic derecho → **Limitar el ámbito de Heft a esta carpeta**: el ámbito queda solo en esa.
- [ ] En la vista de Heft, clic derecho en una carpeta → **Limitar el ámbito…** y **Revelar en el explorador**.

**Actualización**
- [ ] Crea o borra un archivo: en 1–2 s la vista se actualiza sola.
- [ ] Lanza un build del proyecto (escribe en `dist/`, ignorado por git): en el registro **no** aparece
      un `Índice (cambios en disco)` nuevo.
- [ ] Haz un commit: el tooltip del archivo muestra el commit nuevo.
- [ ] Cambia un ajuste `heft.*` (*Settings → Heft*): se vuelve a analizar.
- [ ] Botón «refrescar» de la cabecera: vuelve a analizar.

## 6. Limitaciones conocidas de esta fase

- Todavía **no hay panel** (tabla + treemap): llega en la fase 2. El ámbito de momento solo afecta a
  la barra de estado y la descripción de la vista.
- En un workspace con **varias carpetas raíz**, Heft analiza solo la primera (queda anotado en el registro).
- El árbol siempre muestra el repo entero; el ámbito se ve con las casillas.
- Cada cambio en disco vuelve a analizar todo el repo (con espera de 1,5 s). En repos grandes
  (miles de archivos) tarda un par de segundos; el análisis incremental es trabajo pendiente.

## 7. Si algo falla

| Síntoma | Qué mirar |
|---------|-----------|
| No aparece el icono de Heft | *Extensions*: ¿está Heft instalada y activada? Recarga la ventana. |
| La vista sale vacía | ¿Tienes una carpeta abierta? Mira **Heft: Mostrar registro**. |
| «No se pudo analizar el repositorio» | El mensaje completo está en el registro. |
| No hay datos de git (commits, `●`) | Si `git` no está en el `PATH`, Heft analiza sin git y lo avisa en el registro (`aviso: No se encuentra «git»…`). |
| `Install from VSIX` falla | Comprueba la versión: Heft pide VS Code ≥ 1.85 (*Help → About*). |
| No hay casillas en las carpetas | Versión del editor demasiado antigua: las casillas en vistas existen desde VS Code 1.80. |

Para cualquier fallo, lo más útil es el texto del registro y, si es visual, una captura.
