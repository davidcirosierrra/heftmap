# Publicar Heft

Qué falta para publicar la extensión y los textos que hay que poner. Fecha: 16-11-2026.
Hecho: licencia, localización, seguridad y registro de errores. Falta lo marcado con [ ].

Cursor instala desde **Open VSX**, no desde el Marketplace de Microsoft. Para Cursor basta Open VSX;
el Marketplace solo hace falta si se quiere llegar a usuarios de VS Code.

## 1. Decisiones

| Decisión | Elegido |
|----------|---------|
| Licencia | **MIT** (`LICENSE`) |
| Repo | **Público** (lo cambia David en GitHub). Antes, ver la lista de [seguridad.md](seguridad.md#antes-de-hacer-público-el-repo) |
| Idioma | **Inglés, castellano y euskera** (`heft.language`). Pendiente: revisión del euskera |
| Dónde | Open VSX primero; el Marketplace de Microsoft cuando esté estable |
| Versión | `0.1.0` hasta tener el análisis incremental |
| Nombre visible | Pendiente. «Heft» coincide con el sistema de build de Rush Stack (Microsoft); el identificador `davidcirosierrra.heft` es único |

## 2. Cuentas y pasos (Open VSX)

1. Entrar en open-vsx.org con GitHub.
2. En el perfil, **Log in with Eclipse** (crear la cuenta de Eclipse Foundation si no hay) y firmar
   el **Publisher Agreement** desde el propio perfil de Open VSX. No es el «Eclipse Contributor
   Agreement» (ECA): es otro documento, y firmarlo solo en la web de Eclipse no basta.
3. Crear un token de acceso en el perfil.
4. Crear el namespace, que tiene que coincidir con `publisher` del `package.json`:
   `npx ovsx create-namespace davidcirosierrra -p <token>`.
5. Publicar: `npx ovsx publish heft.vsix -p <token>`.
6. Desde febrero-marzo de 2026 Open VSX revisa cada extensión antes de publicarla (secretos,
   suplantación de nombres, patrones maliciosos). Puede quedar en cuarentena unas horas.

Para el Marketplace: crear un publisher en marketplace.visualstudio.com/manage con el mismo ID,
un token de Azure DevOps con permiso *Marketplace (Manage)* y `npx vsce publish`.

Automatizarlo después con una GitHub Action al crear un tag `v*`
(`HaaLeo/publish-vscode-extension` publica en los dos registros).

## 3. Cambios técnicos en el repo

**`package.json`**
- [x] Quitar `"private": true`.
- [x] `"license": "MIT"` y el archivo `LICENSE`.
- [ ] `"icon": "media/icon.png"`: **PNG** de al menos 128×128 (mejor 256×256). La tienda no admite
      SVG como icono. `media/heft.svg` se queda para la barra de actividad.
- [x] `"displayName"` y `"description"` (en `package.nls*.json`, tres idiomas).
- [ ] `"keywords"` de la sección 4.
- [ ] `"categories"`: `["Visualization", "Other"]` está bien.
- [x] `"author"`, `"homepage"` y `"bugs"` con la URL del repo.
- [ ] `"galleryBanner": { "color": "#1f1f1f", "theme": "dark" }`.
- [x] Quitar `"bin"`: el CLI no va en el `.vsix` (se sigue usando con `npm run heft`).
- [ ] `"engines.vscode"`: comprobar la versión de VS Code en la que se basa Cursor
      (*Help → About*) y no pedir más. Hoy `^1.85.0`.

**`README.md`**: es la página de la tienda. Hoy es un README de desarrollo; hay que separarlo:
- [ ] `README.md` para la tienda (sección 5).
- [ ] Lo de desarrollo, a `CONTRIBUTING.md`.
- [ ] Capturas nuevas de la v2 (las de `docs/capturas-v1/` son del diseño antiguo y salen la
      ciudad 3D descartada). Las imágenes tienen que servirse por **https** y no pueden ser SVG.
      Con el repo público, `vsce` convierte las rutas relativas en URLs de GitHub; si no, ponerlas
      en un sitio público y usar `--baseImagesUrl`.
- [ ] Un GIF corto: abrir el panel, pulsar «Hotspots», seleccionar en el treemap.

**Otros archivos**
- [ ] `CHANGELOG.md` (sección 6). La tienda lo enseña en una pestaña.
- [x] `LICENSE` y `SECURITY.md`.
- [x] `.vscodeignore`: incluye `LICENSE`, `SECURITY.md` y los `package.nls*.json`. Falta `CHANGELOG.md`
      cuando exista. Los `.map` de `dist/` (13,8 MB el del worker) ya no entran porque la
      lista es explícita; que siga así.
- [x] `SECURITY.md`: avisos por *private vulnerability reporting* de GitHub (hay que activarlo).

**Comprobaciones**
- [ ] `npx vsce ls` lista solo lo esperado.
- [ ] `npx vsce package` sin avisos (hoy avisa del tamaño del worker: 3,4 MB, es TypeScript).
- [ ] Instalar el `.vsix` en un Cursor y un VS Code limpios, sin la carpeta del repo.
- [ ] Pasar la lista de `prepareextension.md` sobre un repo grande.

## 4. Textos para el `package.json`

**`displayName`**: `Heft — peso y uso de archivos`

**`description`** (la tienda corta hacia los 100-150 caracteres):
> Qué pesa en tu repo y si se usa: tabla de archivos, treemap, recursos sin rastro, último cambio en git y hotspots.

En inglés, si se traduce:
> What's heavy in your repo and whether it's used: file table, treemap, unreferenced assets, git history and hotspots.

**`keywords`** (máx. 30): `treemap`, `file size`, `disk usage`, `unused files`, `orphan`,
`dead assets`, `hotspots`, `git`, `churn`, `bundle size`, `tamaño`, `huérfanos`, `assets`,
`monorepo`.

## 5. README de la tienda (borrador)

```markdown
# Heft

**¿Qué pesa en este repo y se está usando?**

Heft enseña el peso de cada archivo y carpeta, qué recursos ya no referencia nadie y dónde está el
código grande que más se toca. Pensada para proyectos web con recursos pesados (modelos `.glb`,
audio, texturas), sirve también en cualquier repo con git.

![Panel de Heft](docs/capturas/panel.png)

## Qué hace

- **Vista «Carpetas»** en la barra lateral: tamaño acumulado y % de cada carpeta, con casillas para
  acotar el análisis a una o varias carpetas.
- **Panel con tabla y treemap**: todos los archivos en una tabla ordenable y filtrable, y un
  treemap enlazado. Área por bytes, √bytes o líneas; color por extensión, uso, antigüedad,
  commits recientes o frecuencia de cambio.
- **Uso**: quién referencia cada archivo (imports, rutas en strings, `url()`, `src`/`href`,
  enlaces de Markdown, `import.meta.glob`) y qué recursos no tienen **ningún rastro**. Para esos,
  «Ignorar» o «Mover a la papelera» (siempre con confirmación).
- **Git**: último commit de cada archivo, cambios sin commit y diff.
- **Hotspots**: un botón cruza líneas y nº de cambios para encontrar el código grande que más
  se toca.

## Qué no hace

- No es un detector de código muerto: para código, el veredicto «sin importadores» es solo un
  aviso. Para eso está [Knip](https://knip.dev).
- No borra nada sin preguntar.
- No envía nada fuera de tu equipo: todo se calcula en local con `git` y los archivos del
  proyecto.

## Requisitos

- `git` en el `PATH` para los datos de historial (sin git funciona, sin esas columnas).
- Cursor o VS Code 1.85 o superior.

## Ajustes

| Ajuste | Por defecto | Para qué |
|--------|-------------|----------|
| `heft.publicDir` | `public` | Carpeta contra la que se resuelven rutas absolutas (`/models/x.glb`) |
| `heft.git.since` | vacío | Limitar el historial en repos grandes, p. ej. `1.year` |
| `heft.usage.ignore` | `[]` | Archivos que nunca cuentan como «sin rastro» |
| `heft.usage.entryPoints` | `[]` | Puntos de entrada extra |

## Límites conocidos

- Cada cambio en disco vuelve a analizar el repo entero (en segundo plano). El análisis
  incremental está en camino.
- En un workspace con varias carpetas raíz se analiza solo la primera.
- Un archivo renombrado empieza a contar cambios desde cero.
- Interfaz en inglés, castellano y euskera (ajuste `heft.language`).
```

## 6. `CHANGELOG.md` (borrador)

```markdown
# Cambios

## 0.1.0 — primera versión pública

- Vista «Carpetas» con tamaños y ámbito por casillas.
- Panel con tabla y treemap enlazados, divisor ajustable y gráfico ocultable.
- Uso: referencias entre archivos, recursos sin rastro, mencionados y puntos de entrada.
- Git: último cambio, cambios sin commit, antigüedad y commits recientes.
- Hotspots: líneas × frecuencia de cambio.
- Análisis en segundo plano con progreso.
```

## 7. Privacidad

La extensión no tiene telemetría ni hace peticiones de red: solo lee archivos y ejecuta `git`
localmente. Merece decirlo en el README (ya está en el borrador) porque la revisión de Open VSX y
los usuarios lo miran.
