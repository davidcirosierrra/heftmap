/**
 * Límites fijos del análisis. Están juntos para que se vea de un vistazo qué acota el trabajo y
 * qué se podrá configurar (plan, fase 2). El retardo antes de reanalizar no está aquí: es un
 * ajuste del host (`heftmap.refreshDelay`), no del núcleo.
 */

/** Texto más grande que esto no se lee (ni líneas ni análisis de uso). */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

/** Más configuraciones que esto no se leen: cada una recorre su carpeta en disco. */
export const MAX_TSCONFIGS = 300;

/**
 * Patrones de `import.meta.glob`: con más comodines `**` que MAX_GLOB_STARS, o más largos que
 * MAX_GLOB_LENGTH, no se evalúan (ver `globToRegExp` en `usage/resolve.ts`).
 */
export const MAX_GLOB_STARS = 3;
export const MAX_GLOB_LENGTH = 300;
