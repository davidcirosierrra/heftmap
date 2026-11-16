# Glosario de la interfaz (en · es · eu)

Términos fijos de Heftmap en los tres idiomas. Los textos completos están en
[`src/i18n/messages.ts`](../src/i18n/messages.ts) (panel, vista lateral, avisos y registro) y en
`package.nls*.json` (comandos, vista y ajustes).

**Pendiente**: revisión del euskera por un hablante nativo antes de publicar.

| Concepto | English | Castellano | Euskara |
|----------|---------|------------|---------|
| Ámbito (carpetas elegidas) | scope | ámbito | esparrua |
| Todo el repositorio | Whole repository | Todo el repositorio | Biltegi osoa |
| Archivo · carpeta | file · folder | archivo · carpeta | fitxategia · karpeta |
| Tamaño · líneas · cambios | size · lines · changes | tamaño · líneas · cambios | tamaina · lerroak · aldaketak |
| Uso | usage | uso | erabilera |
| Referenciado | Referenced | Referenciado | Erreferentziatua |
| Mencionado | Mentioned | Mencionado | Aipatua |
| Sin rastro | No trace | Sin rastro | Arrastorik gabe |
| Sin importadores | No importers | Sin importadores | Inportatzailerik gabe |
| Punto de entrada | Entry point | Punto de entrada | Sarrera-puntua |
| No analizado | Not analyzed | No analizado | Aztertu gabea |
| Huérfano | orphan | huérfano | umezurtza |
| Último cambio | Last change | Último cambio | Azken aldaketa |
| Cambios sin commit | Uncommitted changes | Cambios sin commit | Commit gabeko aldaketak |
| Nuevo (sin commits) | new | nuevo | berria |
| Área · color (del treemap) | Area · Color | Área · Color | Azalera · Kolorea |
| Equilibrado (√bytes) | Balanced | Equilibrado | Orekatua |
| Extensión (de archivo) | Extension | Extensión | Luzapena |
| Antigüedad | Age | Antigüedad | Antzinatasuna |
| Explorador | Explorer | explorador | arakatzailea |
| Papelera | Trash | papelera | zakarrontzia |
| Registro (Output) | log | registro | erregistroa |

Sin traducir en ningún idioma: Heftmap, treemap, hotspots, commit, hash, diff, lockfile, import.

## Formatos

| | English | Castellano | Euskara |
|--|---------|------------|---------|
| Número | 3,006 · 1.5 | 3006 · 1,5 | 3006 · 1,5 |
| Porcentaje | 51% · <0.1% | 51 % · <0,1 % | % 51 · <% 0,1 |
| Fecha relativa | 3 d ago | hace 3 d | duela 3 egun |
| Fecha | 11/12/2026 | 12/11/2026 | 2026/11/12 |

Chromium (y con él el panel dentro de VS Code) no trae datos de euskera para `Intl`. En ese caso
Heftmap usa los separadores del castellano y monta a mano el porcentaje y la fecha
(`src/i18n/index.ts`).
