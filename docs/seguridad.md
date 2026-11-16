# Seguridad

Revisión previa a la publicación (16-11-2026). Cómo avisar de un problema: [SECURITY.md](../SECURITY.md).

## Modelo de amenaza

Heft se activa sola al abrir cualquier carpeta y la analiza: lee sus archivos, ejecuta `git` y,
con TypeScript, resuelve imports. **La carpeta es la entrada no fiable**: puede ser un repo
descargado o preparado a propósito. Lo que no debe pasar:

1. Que abrir una carpeta ejecute código que trae la propia carpeta.
2. Que su contenido cuelgue el análisis o se coma la máquina.
3. Que Heft lea, borre o envíe algo fuera de ella.
4. Que el panel (un webview) ejecute código o haga cosas en nombre del usuario sin que este lo pida.

Heft no hace peticiones de red ni tiene telemetría: no hay `fetch`, `http`, `net` ni sockets en el código.

## Encontrado y corregido

| # | Problema | Gravedad | Arreglo |
|---|----------|----------|---------|
| 1 | **Ejecución de código con `core.fsmonitor`**. Un `.git/config` con `core.fsmonitor = <programa>` hace que `git status` lo ejecute. Abrir una carpeta descargada (zip, tarball, carpeta compartida: no un `git clone`, que no copia la config) ejecutaba ese programa. Reproducido. | Crítica | `-c core.fsmonitor=false` en cada llamada a git (`src/core/git.ts`), con un test que lo comprueba |
| 2 | **Otras formas de ejecutar código desde `.git/config`**: filtros de `.gitattributes` (`filter.*.clean`), `gpg.program` con `log.showSignature`, submódulos. Los filtros no se pueden desactivar en general. | Alta | **Workspace Trust**: en una carpeta sin confianza Heft no ejecuta git (analiza como carpeta sin repo) y lo dice en la vista. Al confiar, se reanaliza con git. Además: `log.showSignature=false`, `submodule.recurse=false`, `--ignore-submodules=all` |
| 3 | **`git.exe` plantado en el repo (Windows)**. Lanzar `git` con `cwd` en el repo hace que Windows busque primero `git.exe` en esa carpeta. | Alta | Git se busca a mano en el `PATH`: solo carpetas absolutas, nunca la analizada ni sus subcarpetas, y solo `git.exe` (nunca `.cmd`/`.bat`) |
| 4 | **ReDoS**: las expresiones de `url()` en CSS y de enlaces Markdown eran cuadráticas con miles de aperturas sin cerrar (20.000 `url(` → 5 s; un CSS de 5 MB, horas). Un `import.meta.glob` con 11 `**/` colgaba el análisis más de un minuto (exponencial). | Media | Repeticiones acotadas y que paran en el siguiente corchete o paréntesis (1 MB hostil < 0,2 s). Los `**/` seguidos se juntan y se rechazan patrones con más de 3 `**` o más de 300 caracteres. Tests con entradas hostiles |
| 5 | **Enlaces simbólicos**: un enlace a `~/.ssh/id_rsa` o a `/dev/zero` se seguía y se leía. | Baja | No se siguen: cuentan como el enlace en sí, igual que en git |
| 6 | **Ajustes del workspace** (`.vscode/settings.json` del repo) entraban en el análisis sin confianza. | Baja | `restrictedConfigurations`: en modo restringido VS Code los ignora |
| 7 | `git status` reescribía el índice del usuario para refrescar marcas de tiempo. | Integridad | `GIT_OPTIONAL_LOCKS=0`; además `GIT_TERMINAL_PROMPT=0` |

## Revisado sin cambios

- **Inyección de órdenes**: git se lanza con `execFile` (sin intérprete) y argumentos en lista. El
  único valor del usuario que llega a git, `heft.git.since`, va pegado a `--since=` como un solo
  argumento.
- **Panel (webview)**: CSP `default-src 'none'`, scripts solo con nonce, recursos solo de `dist/`.
  React escapa todo lo que pinta; no hay `innerHTML` ni `eval`. Los estilos en línea los pone React
  por CSSOM, que la CSP no bloquea.
- **Mensajes del panel a la extensión**: no se dan por buenos. Abrir, revelar y ver diff solo
  aceptan rutas que están en el índice; mover a la papelera solo acepta archivos que el índice
  da por «sin rastro» y siempre pide confirmación modal (`useTrash`, recuperable).
- **Tooltips Markdown de la vista**: `MarkdownString` sin `isTrusted` (los enlaces `command:` no se
  ejecutan); asunto y autor del commit escapados; rutas como texto.
- **TypeScript** solo lee archivos (tsconfig y sus `extends`); no carga plugins.
- **Aislamiento**: el análisis corre en un worker; si se cuelga o falla, la extensión sigue.
- **Secretos en el historial**: revisados los 28 commits (búsqueda de claves, tokens y archivos
  `.env`/`.pem`) y el árbol con secretlint: nada.
- **Dependencias** que van en el `.vsix` (`typescript`, `react`, `react-dom`, `d3-hierarchy`):
  `npm audit` sin avisos. Hay 2 avisos moderados en `minimatch`, que solo usa `vsce` (empaquetado)
  y no entra en la extensión.

## Límites conocidos

- En una carpeta **de confianza** con un `.git/config` hostil, un filtro de `.gitattributes`
  todavía se ejecutaría en `git status`, como pasaría con la extensión de git de VS Code o con
  `git status` en la terminal. Es lo que significa confiar en la carpeta.
- El análisis de uso de un repo enorme puede tardar y consumir CPU (búsqueda de menciones); corre
  en un worker y se cancela al cambiar de carpeta o lanzar otro análisis.
- Los archivos de más de 5 MB no se leen como texto.

## Antes de hacer público el repo

- [ ] El historial lleva el nombre y el email de autor de cada commit. Al hacerlo público quedan
      visibles. Si no quieres que se vea el email, hay que reescribir el historial antes.
- [ ] En GitHub: activar *Private vulnerability reporting* (Settings → Security), Dependabot alerts
      y secret scanning, y proteger `main` (sin push directo, PR obligatorio).
- [ ] Token de Open VSX como secreto del repo (`OVSX_PAT`), nunca en el código. Publicar desde una
      GitHub Action al crear un tag.
- [ ] Autenticación en dos pasos en GitHub, Open VSX/Eclipse y npm.
