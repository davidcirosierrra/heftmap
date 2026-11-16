# Publicar Heft

Guía paso a paso. Fecha: 16-11-2026. Lo marcado **(David)** solo lo puedes hacer tú; el resto ya
está en el repo.

Cursor instala desde **Open VSX**, no desde el Marketplace de Microsoft. Para Cursor basta Open VSX;
el Marketplace solo hace falta para llegar a usuarios de VS Code (sección 6).

## 1. Ya está hecho en el repo

- Licencia MIT, `SECURITY.md`, `CHANGELOG.md`.
- `package.json`: nombre visible y descripción en tres idiomas (`package.nls*.json`), icono
  (`media/icon.png`, 256×256), `galleryBanner`, `keywords`, `author`, `homepage`, `bugs`.
- README de la tienda en inglés (`README.md`), con versiones en castellano y euskera
  (`README.es.md`, `README.eu.md`). Lo de desarrollo está en `CONTRIBUTING.md`.
- Capturas en `docs/images/` (hotspots, uso, antigüedad), hechas con el panel real sobre el repo
  de Vite.
- GitHub Actions: **desactivado**. `ci.yml` (tests) y `publish.yml` (publicación) están en
  `docs/workflows/`, fuera de `.github/workflows/`, y GitHub no los ejecuta. Para activarlos,
  moverlos a `.github/workflows/`.

## 2. Antes de hacer público el repo (David)

1. **Emails del historial.** Al hacerlo público, el email de autor de cada commit queda visible.
   En el historial hay dos tuyos: el personal y el de Tecnalia (en un commit hecho desde el
   trabajo). Si no quieres que se vean, hay que reescribir el historial *antes* de hacerlo
   público (después ya está copiado). Para los commits futuros: GitHub → Settings → Emails →
   *Keep my email addresses private* y usar el email `…@users.noreply.github.com`.
2. **Hacerlo público**: Settings → General → Danger Zone → *Change visibility*.
3. **Seguridad** (Settings → Advanced Security): activar *Private vulnerability reporting* (lo
   usa `SECURITY.md`), *Dependabot alerts* y *Secret scanning*.
4. **Proteger `main`** (Settings → Rules → Rulesets): PR obligatorio y que pase `CI`.
5. **Revisar el euskera** de `src/i18n/messages.ts`, `package.nls.eu.json` y `README.eu.md`.

## 3. Cuenta en Open VSX (David, una vez)

1. **GitHub**: entra en https://open-vsx.org con tu cuenta de GitHub (`davidcirosierrra`).
2. **Eclipse**: crea una cuenta en https://accounts.eclipse.org/user/register. En el campo
   *GitHub Username* pon **exactamente** `davidcirosierrra`, el mismo usuario con el que entras en
   open-vsx.org.
3. **Acuerdo de publicación**: en open-vsx.org → avatar → *Settings* → *Log in with Eclipse*. Luego
   *Show Publisher Agreement*, léelo hasta el final y *Agree*. No es el «Eclipse Contributor
   Agreement» (ECA): ese es para contribuir código a Eclipse y no sirve aquí.
4. **Namespace** (tiene que coincidir con `publisher` del `package.json`): en *Settings*, junto
   a *Namespaces*, el botón **+** → `notime-labs`. Sin namespace no se puede registrar el
   *Trusted Publisher*.
5. **Trusted Publisher** (en vez de token): *Settings* → *Trusted Publishers* → registrar
   repositorio `davidcirosierrra/heft`, workflow `publish.yml` y entorno `openvsx`. Así GitHub
   Actions publica con un token OIDC que dura minutos y solo vale para ese repo, ese archivo y
   ese entorno: no hay ningún secreto guardado que se pueda filtrar. Se puede registrar ya,
   aunque la acción esté desactivada.
6. **Verificar el namespace** (opcional pero recomendable): crearlo no te hace propietario
   verificado. Se pide en el repo de Open VSX con una incidencia de *namespace access*. Cursor
   tiene su propia verificación de publicadores (se pide en su foro) y exige antes la de Open VSX.

## 4. Primera publicación (David)

**Publicar con GitHub Actions** (desactivado ahora). Para activarlo:
`git mv docs/workflows/publish.yml .github/workflows/publish.yml`, quitar el comentario
«DESACTIVADO» y hacer merge a `main`. Después:

1. En GitHub → Settings → Environments → *New environment* `openvsx`, sin secretos. Activa
   *Required reviewers* contigo: cada publicación esperará a que la apruebes.
2. Comprueba que `package.json` tiene la versión que quieres (`0.1.0`).
3. GitHub → Releases → *Draft a new release* → tag `v0.1.0` → título `0.1.0` → copia la sección
   de `CHANGELOG.md` → *Publish release*.
4. La acción `Publish` pasa los tests, empaqueta, publica en Open VSX y adjunta el `.vsix` a la
   release. Si algo falla, el registro de la acción lo dice.
5. Open VSX revisa cada extensión al publicar (secretos, archivos maliciosos conocidos, nombres
   parecidos a otros). Si la rechaza, el error dice qué comprobación falló.
6. Comprueba la página en https://open-vsx.org/extension/notime-labs/heft y búscala en Cursor
   (*Extensions* → «Heft»). Puede tardar un rato en aparecer en Cursor.

**Alternativa sin GitHub Actions**: genera un token en *Settings* → *Access Tokens* (solo para
esto, y bórralo después), `npm run package` y `npx ovsx publish heft.vsix -p <token>` desde tu
equipo.

## 5. Versiones siguientes

1. Sube `version` en `package.json` y añade la sección en `CHANGELOG.md` (PR normal).
2. Release con tag `vX.Y.Z` igual a la versión. La acción comprueba que coinciden.

## 6. Marketplace de Microsoft (opcional, más adelante)

Para usuarios de VS Code. Hace falta una cuenta de Microsoft, crear el publisher
`notime-labs` en https://marketplace.visualstudio.com/manage y un token de Azure DevOps con
permiso *Marketplace (Manage)*. Microsoft está cambiando estos tokens por otro sistema de
identidad a finales de 2026: mirar la documentación del momento antes de hacerlo. Luego se añade
un paso `npx vsce publish -i heft.vsix` a `publish.yml` con su secreto.

## 7. Pendiente

- [ ] (David) Pasos 2, 3 y 4.
- [ ] (David) Una captura de la ventana completa de Cursor con la vista «Carpetas» y el panel, y si
      puedes un GIF corto (abrir panel → *Hotspots* → clic en el treemap). Se guardan en
      `docs/images/` y se añaden al README.
- [ ] Nombre visible: «Heft» coincide con el sistema de build de Rush Stack (Microsoft). El
      identificador `notime-labs.heft` es único; si Open VSX lo rechazara por parecido, se
      cambia `name`.
