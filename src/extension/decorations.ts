import * as vscode from 'vscode';
import { weightTier, type WeightTier } from './bars.js';

/**
 * Color por peso en la vista «Carpetas». La vista pinta cada elemento con su URI más
 * `?heft=<tramo>` (`decoratedUri`), y `HeftDecorations` solo tiñe esos URI.
 */

/**
 * URI con el que la vista pinta un elemento: el del archivo con `?heft=<tramo>`. Los iconos
 * del tema salen igual (dependen del nombre), y el color por peso (`HeftDecorations`) solo
 * se aplica a estos URI: el explorador nativo y las pestañas no se tiñen.
 */
export function decoratedUri(uri: vscode.Uri | undefined, fraction: number): vscode.Uri | undefined {
  return uri?.with({ query: `heft=${weightTier(fraction) ?? 'none'}` });
}

/** Color del nombre por peso dentro de la carpeta padre (la barra, en la descripción, no admite color). */
const TIER_COLOR: Record<WeightTier, string> = {
  heavy: 'charts.red',
  large: 'charts.orange',
  notable: 'charts.yellow',
};

export class HeftDecorations implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const tier = /(?:^|&)heft=(\w+)/.exec(uri.query)?.[1];
    if (!tier || !(tier in TIER_COLOR)) return undefined;
    return new vscode.FileDecoration(undefined, undefined, new vscode.ThemeColor(TIER_COLOR[tier as WeightTier]));
  }
}
