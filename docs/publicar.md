# Publicar Heftmap

Guía y estado de la publicación en **Open VSX**, que es de donde instala Cursor. El Marketplace de
Microsoft (para VS Code) queda para más adelante (sección 6). Lo marcado **(David)** solo lo puede
hacer el dueño de las cuentas.

## Estado (17-11-2026): esperando a Open VSX

Todo lo del repo está listo. Falta que Open VSX dé a `davidcirosierrra` la propiedad del namespace
`notime-labs` (incidencia [#15802](https://github.com/EclipseFdn/open-vsx.org/issues/15802)). Hasta
entonces no se puede registrar el Trusted Publisher: solo puede hacerlo el **propietario** del
namespace, y crear el namespace no lo hace a uno propietario.

**Pendiente, en este orden:**

- [ ] (Open VSX) Aprobar la incidencia #15802. Se ha contestado a su pregunta (relación con el
      namespace) y se ha avisado del cambio de repo de `Heft` a `heftmap`. Al aprobarla, el aviso
      ⚠ de `notime-labs` desaparece en open-vsx.org → *Settings*.
- [ ] (David) Registrar el **Trusted Publisher** (sección 3, paso 4).
- [ ] (David) Crear la release **`v0.1.0`** y aprobar el despliegue (sección 4).
- [ ] (David) Comprobar la extensión en Open VSX y en Cursor (sección 4, paso 5).
- [ ] (Opcional) Pedir la verificación de publicador en el foro de Cursor, cuando Open VSX ya la
      muestre como verificada.

No publicar antes con un token de acceso: con el namespace sin verificar, la extensión puede
quedar inactiva o salir como «no verificada».

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
3. Namespace `notime-labs` (igual que `publisher` en `package.json`): **creado**; falta la
   propiedad (incidencia #15802).

4. **Trusted Publisher** (cuando la #15802 esté aprobada): *Settings* → *Trusted Publishers* →
   - namespace `notime-labs`;
   - repositorio `notime-labs/heftmap` (owner `notime-labs`, repo `heftmap`);
   - workflow `publish.yml`;
   - entorno `openvsx`.

   Los tres últimos tienen que coincidir con `.github/workflows/publish.yml`. GitHub Actions
   publica con un token OIDC que dura minutos y solo vale para ese repo, ese archivo y ese
   entorno: no hay ningún secreto guardado.

No pulsar *Claim Ownership* en la página del namespace: abre otra incidencia como la #15802.

## 4. Primera publicación (David)

1. Comprobar que `package.json` dice `0.1.0` y que `CHANGELOG.md` tiene su sección.
2. GitHub → Releases → *Draft a new release* → tag nuevo `v0.1.0` sobre `main` → título `0.1.0` →
   texto de la sección 0.1.0 del CHANGELOG → *Publish release*.
3. Actions → *Publish* → el job espera aprobación del entorno `openvsx` → *Review deployments* →
   *Approve and deploy*.
4. La acción pasa typecheck y tests, comprueba que el tag coincide con la versión, empaqueta,
   publica en Open VSX y adjunta `heftmap.vsix` a la release. Open VSX revisa cada extensión al
   publicar (secretos, archivos maliciosos conocidos, nombres parecidos); si la rechaza, el
   registro de la acción dice qué comprobación falló.
5. Comprobar https://open-vsx.org/extension/notime-labs/heftmap y buscarla en Cursor
   (*Extensions* → «Heftmap»). Puede tardar un rato en salir en Cursor.

Si la acción falla después de crear la release: arreglar en un PR, borrar la release y el tag
`v0.1.0` en GitHub, y volver a crearlos. Si ya se publicó en Open VSX, no se puede volver a subir
la misma versión: subir a `0.1.1`.

**Alternativa sin GitHub Actions** (solo si hiciera falta): token de un solo uso en *Settings* →
*Access Tokens*, `npm run package` y `npx ovsx publish heftmap.vsix -p <token>`; borrar el token
después.

## 5. Versiones siguientes

1. Subir `version` en `package.json` y añadir su sección en `CHANGELOG.md` (PR normal).
2. Release con tag `vX.Y.Z` igual a la versión y aprobar el despliegue. La acción comprueba que
   coinciden.

## 6. Marketplace de Microsoft (opcional, más adelante)

Para usuarios de VS Code. Hace falta una cuenta de Microsoft, crear el publisher `notime-labs` en
https://marketplace.visualstudio.com/manage y una credencial con permiso *Marketplace (Manage)*.
Microsoft está cambiando los tokens de Azure DevOps por otro sistema de identidad a finales de
2026: mirar la documentación del momento. Luego se añade un paso `npx vsce publish -i heftmap.vsix`
a `publish.yml`.
