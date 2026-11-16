/**
 * Doble mínimo de la API `vscode` para el test de humo de la extensión. Solo cubre lo que
 * usa Heft y guarda lo necesario para inspeccionarlo desde el test.
 */
import path from 'node:path';

type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];
  event = (fn: Listener<T>) => {
    this.listeners.push(fn);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== fn)) };
  };
  fire(e: T): void {
    for (const l of this.listeners) l(e);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class Uri {
  private constructor(
    readonly fsPath: string,
    readonly path: string,
  ) {}
  static file(p: string): Uri {
    return new Uri(p, p.split(path.sep).join('/'));
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return Uri.file(path.join(base.fsPath, ...parts));
  }
  toString(): string {
    return `file://${this.path}`;
  }
}

export class RelativePattern {
  constructor(
    readonly base: Uri,
    readonly pattern: string,
  ) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}
export enum TreeItemCheckboxState {
  Unchecked = 0,
  Checked = 1,
}
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class ThemeIcon {
  static Folder = new ThemeIcon('folder');
  static File = new ThemeIcon('file');
  constructor(readonly id: string) {}
}

export class MarkdownString {
  value = '';
  appendMarkdown(s: string): this {
    this.value += s;
    return this;
  }
  /** Como la real: el texto se escapa para que no se interprete como Markdown. */
  appendText(s: string): this {
    this.value += s.replace(/[\\`*_{}[\]()#+\-!~]/g, '\\$&');
    return this;
  }
}

export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: string | MarkdownString;
  resourceUri?: Uri;
  iconPath?: ThemeIcon;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  checkboxState?: { state: TreeItemCheckboxState; tooltip?: string };
  constructor(
    readonly label: string,
    readonly collapsibleState: TreeItemCollapsibleState,
  ) {}
}

const disposable = { dispose: () => undefined };

// ------------------------------------------------------------------ estado inspeccionable

export const fake = {
  root: '' as string,
  config: {} as Record<string, unknown>,
  commands: new Map<string, (...args: any[]) => unknown>(),
  executed: [] as { id: string; args: unknown[] }[],
  infos: [] as string[],
  quickPickAnswer: undefined as ((items: any[]) => any[] | undefined) | undefined,
  log: [] as string[],
  /** Eventos del FileSystemWatcher, para dispararlos desde el test. */
  fs: { create: new EventEmitter<Uri>(), change: new EventEmitter<Uri>(), delete: new EventEmitter<Uri>() },
  watchers: 0,
  /** Llamadas a withProgress: dónde se pinta y si la tarea ya terminó. */
  progress: [] as { location: unknown; done: boolean }[],
  folderListeners: [] as (() => unknown)[],
  treeView: undefined as
    | {
        provider: any;
        description?: string;
        message?: string;
        options: any;
        checkbox: EventEmitter<{ items: [unknown, TreeItemCheckboxState][] }>;
      }
    | undefined,
  status: { text: '', tooltip: '', visible: false },
  state: new Map<string, unknown>(),
  reset(root: string): void {
    this.root = root;
    this.config = {};
    this.commands.clear();
    this.executed = [];
    this.infos = [];
    this.log = [];
    this.fs = { create: new EventEmitter<Uri>(), change: new EventEmitter<Uri>(), delete: new EventEmitter<Uri>() };
    this.watchers = 0;
    this.progress = [];
    this.folderListeners = [];
    this.treeView = undefined;
    this.state.clear();
  },
};

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: (s: string) => fake.log.push(s),
    show: () => undefined,
    dispose: () => undefined,
  }),
  createTreeView: (_id: string, options: any) => {
    const checkbox = new EventEmitter<{ items: [unknown, TreeItemCheckboxState][] }>();
    const view = {
      provider: options.treeDataProvider,
      options,
      checkbox,
      description: undefined as string | undefined,
      message: undefined as string | undefined,
      onDidChangeCheckboxState: checkbox.event,
      dispose: () => undefined,
    };
    fake.treeView = view;
    return view;
  },
  createStatusBarItem: () => ({
    set text(v: string) {
      fake.status.text = v;
    },
    get text() {
      return fake.status.text;
    },
    set tooltip(v: string) {
      fake.status.tooltip = v;
    },
    name: '',
    command: '',
    show: () => (fake.status.visible = true),
    hide: () => (fake.status.visible = false),
    dispose: () => undefined,
  }),
  showInformationMessage: async (msg: string) => {
    fake.infos.push(msg);
    return undefined;
  },
  showQuickPick: async (items: any[]) => fake.quickPickAnswer?.(items),
  withProgress: async <T>(options: { location: unknown }, task: () => Promise<T>): Promise<T> => {
    fake.progress.push({ location: options.location, done: false });
    const entry = fake.progress.at(-1)!;
    try {
      return await task();
    } finally {
      entry.done = true;
    }
  },
};

export const commands = {
  registerCommand: (id: string, fn: (...args: any[]) => unknown) => {
    fake.commands.set(id, fn);
    return disposable;
  },
  executeCommand: async (id: string, ...args: unknown[]) => {
    fake.executed.push({ id, args });
    return fake.commands.get(id)?.(...args);
  },
};

export const workspace = {
  get workspaceFolders() {
    return fake.root ? [{ uri: Uri.file(fake.root), name: path.basename(fake.root), index: 0 }] : undefined;
  },
  getConfiguration: (_section: string) => ({
    get: <T>(key: string) => fake.config[key] as T | undefined,
  }),
  onDidChangeConfiguration: () => disposable,
  onDidChangeWorkspaceFolders: (fn: () => unknown) => {
    fake.folderListeners.push(fn);
    return disposable;
  },
  createFileSystemWatcher: () => {
    fake.watchers++;
    return {
      onDidCreate: (fn: (u: Uri) => unknown) => fake.fs.create.event(fn),
      onDidChange: (fn: (u: Uri) => unknown) => fake.fs.change.event(fn),
      onDidDelete: (fn: (u: Uri) => unknown) => fake.fs.delete.event(fn),
      dispose: () => void fake.watchers--,
    };
  },
};

export function makeContext() {
  return {
    subscriptions: [] as { dispose(): unknown }[],
    workspaceState: {
      get: (k: string) => fake.state.get(k),
      update: async (k: string, v: unknown) => void fake.state.set(k, v),
    },
  };
}
