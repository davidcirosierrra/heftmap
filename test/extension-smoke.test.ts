import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activate } from '../src/extension/extension.js';
import { fake, makeContext, TreeItemCheckboxState, Uri, type TreeItem } from './fake-vscode.js';
import { createKartGame } from './fixture.js';
import { inProcessRunner } from './in-process-runner.js';

/**
 * Test de humo: la extensión real contra un `vscode` simulado (alias en vitest.config.ts)
 * sobre el proyecto kart-game. No sustituye a probarla en Cursor (prepareextension.md).
 */
let root: string;
let context: ReturnType<typeof makeContext>;

const provider = () => fake.treeView!.provider;
const items = (node?: unknown): { node: any; item: TreeItem }[] =>
  provider()
    .getChildren(node)
    .map((n: unknown) => ({ node: n, item: provider().getTreeItem(n) as TreeItem }));
const find = (label: string, node?: unknown) => {
  const hit = items(node).find((x) => x.item.label === label);
  if (!hit) throw new Error(`no hay «${label}» en el árbol`);
  return hit;
};
const waitFor = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
  expect(cond()).toBe(true);
};
const check = (node: unknown, checked: boolean): void =>
  fake.treeView!.checkbox.fire({
    items: [[node, checked ? TreeItemCheckboxState.Checked : TreeItemCheckboxState.Unchecked]],
  });

beforeAll(async () => {
  root = createKartGame();
  fake.reset(root);
  context = makeContext();
  activate(context as never, inProcessRunner);
  await waitFor(() => fake.log.some((l) => l.includes('Índice (inicio)')));
});
afterAll(() => {
  for (const d of context.subscriptions) d.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('extensión (humo)', () => {
  it('registra los comandos del package.json', () => {
    for (const id of ['heftmap.refresh', 'heftmap.pickScope', 'heftmap.clearScope', 'heftmap.addToScope', 'heftmap.limitScope', 'heftmap.revealInExplorer', 'heftmap.showLog']) {
      expect(fake.commands.has(id)).toBe(true);
    }
    expect(fake.treeView!.options.manageCheckboxStateManually).toBe(true);
  });

  it('el nombre se colorea por peso solo en la vista de Heftmap, no en el explorador', () => {
    const top = items();
    const pub = top[0]!.item;
    expect(pub.resourceUri!.query).toBe('heft=heavy');
    const deco = fake.decorations!.provideFileDecoration(pub.resourceUri as never);
    expect(deco?.color?.id).toBe('charts.red');
    // El mismo archivo sin la marca (explorador, pestañas): sin color.
    expect(fake.decorations!.provideFileDecoration(Uri.file(pub.resourceUri!.fsPath) as never)).toBeUndefined();
    const light = top.find((x) => x.item.resourceUri?.query === 'heft=none');
    expect(light).toBeDefined();
    expect(fake.decorations!.provideFileDecoration(light!.item.resourceUri as never)).toBeUndefined();
  });

  it('pinta carpetas de mayor a menor con tamaño, % y nº de archivos', () => {
    const top = items();
    expect(top[0]!.item.label).toBe('public');
    expect(top[0]!.item.description).toMatch(/^█+\S* \d+(,\d)? % · \d+,\d MB · 10 arch\.$/);
    const models = find('models', top[0]!.node);
    expect(models.item.checkboxState?.state).toBe(TreeItemCheckboxState.Unchecked);
  });

  it('un archivo abre al hacer clic y lleva tooltip con uso y commit', () => {
    const game = find('game', find('src').node);
    const physics = find('Physics.ts', game.node);
    expect(physics.item.command?.command).toBe('vscode.open');
    expect(physics.item.description).toContain('●'); // cambios sin commit
    const tip = (physics.item.tooltip as { value: string }).value;
    expect(tip).toContain('Referenciado');
    expect(tip).toContain('3 cambios');
  });

  it('marcar una casilla cambia el ámbito, la descripción y la barra de estado', () => {
    check(find('src').node, true);
    expect(fake.state.get('heftmap.scope')).toEqual(['src']);
    expect(fake.treeView!.description).toBe('src · 13 KB · 12 archivos');
    expect(fake.status.text).toMatch(/Heftmap: src · 12 archivos · \d+ KB/);
    // Las subcarpetas salen marcadas por el ancestro
    const game = find('game', find('src').node);
    expect(game.item.checkboxState?.state).toBe(TreeItemCheckboxState.Checked);
    expect(game.item.checkboxState?.tooltip).toBe('En el ámbito por «src/»');
  });

  it('desmarcar una subcarpeta cubierta por un ancestro avisa y no cambia nada', () => {
    const game = find('game', find('src').node);
    check(game.node, false);
    expect(fake.state.get('heftmap.scope')).toEqual(['src']);
    expect(fake.infos.at(-1)).toContain('Quita primero «src/»');
  });

  it('menú contextual del explorador: añadir y limitar, con selección múltiple', async () => {
    const u = (p: string) => Uri.file(path.join(root, p));
    await fake.commands.get('heftmap.addToScope')!(u('public/models'), [u('public/models'), u('public/audio')]);
    expect(fake.state.get('heftmap.scope')).toEqual(['public/audio', 'public/models', 'src']);
    await fake.commands.get('heftmap.limitScope')!(u('public'));
    expect(fake.state.get('heftmap.scope')).toEqual(['public']);
  });

  it('selector de carpetas (QuickPick) y «Todo el repositorio»', async () => {
    fake.quickPickAnswer = (list) => list.filter((i) => i.path === 'src/game' || i.path === 'docs');
    await fake.commands.get('heftmap.pickScope')!();
    expect(fake.state.get('heftmap.scope')).toEqual(['docs', 'src/game']);
    await fake.commands.get('heftmap.clearScope')!();
    expect(fake.state.get('heftmap.scope')).toEqual([]);
    expect(fake.treeView!.description).toMatch(/^Todo el repositorio · \d+ MB · 30 archivos$/);
  });
});
