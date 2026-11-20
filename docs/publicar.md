# Publicar Heftmap

Guía y estado de la publicación. Heftmap está en dos tiendas:

- **Open VSX** (de ahí instala Cursor): https://open-vsx.org/extension/notime-labs/heftmap
- **Visual Studio Marketplace** (VS Code):
  https://marketplace.visualstudio.com/items?itemName=notime-labs.heftmap

Las dos con el publisher `notime-labs`. Lo marcado **(David)** solo lo puede hacer el dueño de las
cuentas.

## Estado (20-11-2026): 0.1.0 publicada en las dos tiendas

La 0.1.0 se publicó **a mano**, arrastrando `heftmap.vsix` a la web de Open VSX y a la del
Marketplace, sin pasar por `publish.yml`. Open VSX dio la propiedad del namespace `notime-labs` (incidencia
[#15802](https://github.com/EclipseFdn/open-vsx.org/issues/15802)).

**Pendiente (nada bloquea):**

- [ ] (David) Registrar el **Trusted Publisher** en Open VSX (sección 3, paso 4), si no está ya.
      Sin él, `publish.yml` falla sin publicar nada.
- [ ] (David) Opcional: release y tag **`v0.1.0`** en GitHub para que el historial tenga la versión
      publicada. Crear la release lanza `publish.yml`: **rechazar** el despliegue del entorno
      `openvsx` (la 0.1.0 ya está en Open VSX y no se puede volver a subir).
- [ ] Añadir el Marketplace a `publish.yml` (sección 6) para que la próxima versión salga en las dos
      tiendas desde la release. Mientras tanto, el Marketplace se publica a mano.
- [ ] (Opcional) Pedir la verificación de publicador en el foro de Cursor, cuando Open VSX ya la
      muestre como verificada.

## 1. Hecho en el repo

- Licencia MIT, `SECURITY.md`, `CHANGELOG.md` con la sección 0.1.0.
- `package.json`: versión `0.1.0`, `publisher` `notime-labs`, nombre y descripción en tres idiomas
  (`package.nls*.json`), icono, `galleryBanner`, `keywords`, `homepage`, `bugs` y `repository`
  apuntando a `notime-labs/heftmap`.
- README en inglés (el de la tienda), castellano y euskera; euskera revisado.
- Capturas de la interfaz final en `docs/images/` (también las usa el walkthrough) y GIF en
  `docs/media/heftmap.gif`, fuera del `.vsix`.
- GitHub Actions:
  - `ci.yml`: typecheck, tests y empaquetado en cada PR y cada push a `main`.
  - `publish.yml`: **activo**. Solo se ejecuta al publicar una release; no hace nada mientras no
    la haya. Usa `ovsx` 1.4.0 fijado y `--trusted-publishing`, así que sin Trusted Publisher
    registrado falla sin publicar nada.

## 2. GitHub (hecho)

- Repo `notime-labs/heftmap` (organización, transferido desde `davidcirosierrra/heftmap`), **público**. Se rehízo desde el antiguo `Heft` (ahora privado)
  con el historial reescrito (`git filter-repo --mailmap`) para que todos los commits lleven el
  email `…@users.noreply.github.com`. Para lo que venga: *Keep my email addresses private* y
  *Block command line pushes that expose my email* activados, y `git config user.email` con el
  `noreply` en el clon local. No usar clones viejos de `Heft`: tienen otros hashes y los emails.
- Ruleset `Protect_Main` sobre `main`: sin borrado ni force-push, PR obligatorio (0 aprobaciones),
  check `test` obligatorio, sin bypass. Ramas borradas automáticamente al mergear.
- Seguridad: *Private vulnerability reporting*, *Dependency graph*, Dependabot (alertas, malware,
  actualizaciones de seguridad agrupadas), *Secret Protection* y *Push protection*.
- Entorno **`openvsx`**: sin secretos ni variables, *Required reviewers* = `davidcirosierrra`
  (sin *Prevent self-review*), y despliegue solo desde tags `v*`.
- Vista previa social: subir `heftmap-social-preview.png` en Settings → *Social preview*, si
  no está ya (la del repo antiguo no se copia).

## 3. Cuenta en Open VSX (David)

1. Entrar en https://open-vsx.org con GitHub (`davidcirosierrra`).
2. Cuenta de Eclipse con *GitHub Username* = `davidcirosierrra` y *Publisher Agreement* firmado
   (avatar → *Settings* → *Log in with Eclipse*). Sin el acuerdo, la publicación falla.
3. Namespace `notime-labs` (igual que `publisher` en `package.json`): creado y con propiedad
   (incidencia #15802, resuelta).

4. **Trusted Publisher**: *Settings* → *Trusted Publishers* →
   - namespace `notime-labs`;
   - repositorio `notime-labs/heftmap` (owner `notime-labs`, repo `heftmap`);
   - workflow `publish.yml`;
   - entorno `openvsx`.

   Los tres últimos tienen que coincidir con `.github/workflows/publish.yml`. GitHub Actions
   publica con un token OIDC que dura minutos y solo vale para ese repo, ese archivo y ese
   entorno: no hay ningún secreto guardado.

No pulsar *Claim Ownership* en la página del namespace: abre otra incidencia como la #15802.

## 4. Publicar una versión con GitHub Actions (David)

La 0.1.0 se subió a mano; a partir de la siguiente, con la release. Requisito: Trusted Publisher
registrado (sección 3, paso 4).

1. Comprobar que `package.json` tiene la versión nueva y que `CHANGELOG.md` tiene su sección.
2. GitHub → Releases → *Draft a new release* → tag nuevo `vX.Y.Z` sobre `main` → título `X.Y.Z` →
   texto de la sección del CHANGELOG → *Publish release*.
3. Actions → *Publish* → el job espera aprobación del entorno `openvsx` → *Review deployments* →
   *Approve and deploy*.
4. La acción pasa typecheck y tests, comprueba que el tag coincide con la versión, empaqueta,
   publica en Open VSX y adjunta `heftmap.vsix` a la release. Open VSX revisa cada extensión al
   publicar (secretos, archivos maliciosos conocidos, nombres parecidos); si la rechaza, el
   registro de la acción dice qué comprobación falló.
5. Mientras `publish.yml` no publique en el Marketplace (sección 6): subir ese mismo `heftmap.vsix`
   a mano en https://marketplace.visualstudio.com/manage → `notime-labs` → Heftmap → *Update*.
6. Comprobar la versión en las dos tiendas y en Cursor (*Extensions* → «Heftmap»). Puede tardar un
   rato en salir en Cursor.

Si la acción falla después de crear la release: arreglar en un PR, borrar la release y el tag en
GitHub, y volver a crearlos. Si ya se publicó en alguna tienda, no se puede volver a subir la misma
versión: subir el parche (`X.Y.Z+1`).

**Sin GitHub Actions** (como la 0.1.0): `npm run package` y subir `heftmap.vsix` en la web de cada
tienda (Open VSX: *Settings* → *Extensions* → *Publish*; Marketplace: página *manage*). O con un
token de un solo uso: `npx ovsx publish heftmap.vsix -p <token>`, y borrar el token después.

## 5. Versiones siguientes

1. Subir `version` en `package.json` y añadir su sección en `CHANGELOG.md` (PR normal).
2. Release con tag `vX.Y.Z` igual a la versión y aprobar el despliegue (sección 4). La acción
   comprueba que coinciden.

## 6. Visual Studio Marketplace

Publisher `notime-labs` creado en https://marketplace.visualstudio.com/manage y 0.1.0 publicada a
mano. Para automatizarlo hace falta una credencial con permiso *Marketplace (Manage)* guardada en
el entorno de GitHub y un paso `npx vsce publish -i heftmap.vsix` en `publish.yml`. Microsoft está
cambiando los tokens de Azure DevOps por otro sistema de identidad a finales de 2026: mirar la
documentación del momento antes de crear la credencial (si permite OIDC, mejor que un token).
