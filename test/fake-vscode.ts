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
    readonly query = '',
  ) {}
  static file(p: string): Uri {
    return new Uri(p, p.split(path.sep).join('/'));
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return Uri.file(path.join(base.fsPath, ...parts));
  }
  with(change: { query?: string }): Uri {
    return new Uri(this.fsPath, this.path, change.query ?? this.query);
  }
  toString(): string {
    return `file://${this.path}${this.query ? `?${this.query}` : ''}`;
  }
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class FileDecoration {
  constructor(
    readonly badge?: string,
    readonly tooltip?: string,
    readonly color?: ThemeColor,
  ) {}
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
export enum ViewColumn {
  Active = -1,
  One = 1,
}
export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
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
  configListeners: [] as ((e: { affectsConfiguration(k: string): boolean }) => unknown)[],
  trustListeners: [] as (() => unknown)[],
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
  clipboard: '' as string,
  decorations: undefined as { provideFileDecoration(uri: Uri): FileDecoration | undefined } | undefined,
  /** Avisos modales: lo que se preguntó y qué botón «pulsa» el test. */
  warnings: [] as { message: string; options: any; items: string[] }[],
  warningAnswer: undefined as string | undefined,
  errors: [] as string[],
  /** Botón que «pulsa» el test en un aviso de error. */
  errorAnswer: undefined as string | undefined,
  deleted: [] as { path: string; options: any }[],
  configUpdates: [] as { key: string; value: unknown; target: unknown }[],
  logShown: 0,
  /** Paneles webview abiertos: lo que la extensión les manda y un emisor para contestarle. */
  panels: [] as {
    viewType: string;
    title: string;
    options: any;
    html: string;
    posted: any[];
    receive: EventEmitter<any>;
    revealed: number;
    disposed: boolean;
    close(): void;
  }[],
  /** Serializadores de paneles, por tipo de webview. */
  serializers: new Map<string, { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> }>(),
  /** Lo que hace el editor al recargar la ventana: un panel vacío que la extensión adopta. */
  async restorePanel(viewType: string, state?: unknown): Promise<void> {
    await this.serializers.get(viewType)?.deserializeWebviewPanel(makePanel(viewType, 'Heft', {}), state);
  },
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
    this.configListeners = [];
    this.trustListeners = [];
    this.treeView = undefined;
    this.panels = [];
    this.serializers.clear();
    this.warnings = [];
    this.warningAnswer = undefined;
    this.errors = [];
    this.errorAnswer = undefined;
    this.deleted = [];
    this.configUpdates = [];
    this.state.clear();
  },
};

/** Un panel webview y su registro en `fake.panels`. */
function makePanel(viewType: string, title: string, options: any) {
  const receive = new EventEmitter<any>();
  const onDispose = new EventEmitter<void>();
  const record = {
    viewType,
    title,
    options,
    html: '',
    posted: [] as any[],
    receive,
    revealed: 0,
    disposed: false,
    close: () => panel.dispose(),
  };
  const panel = {
    iconPath: undefined as unknown,
    webview: {
      cspSource: 'vscode-webview://fake',
      asWebviewUri: (u: Uri) => u,
      set options(v: any) {
        record.options = v;
      },
      get options() {
        return record.options;
      },
      set html(v: string) {
        record.html = v;
      },
      get html() {
        return record.html;
      },
      postMessage: async (m: unknown) => {
        // Como el real: lo que cruza es una copia serializada.
        record.posted.push(JSON.parse(JSON.stringify(m)));
        return true;
      },
      onDidReceiveMessage: receive.event,
    },
    onDidDispose: onDispose.event,
    reveal: () => void record.revealed++,
    dispose: () => {
      if (record.disposed) return;
      record.disposed = true;
      onDispose.fire();
    },
  };
  fake.panels.push(record);
  return panel;
}

export const window = {
  createOutputChannel: (_name: string, _opts?: unknown) => ({
    appendLine: (s: string) => fake.log.push(s),
    info: (s: string) => fake.log.push(s),
    warn: (s: string) => fake.log.push(`[warn] ${s}`),
    error: (s: string) => fake.log.push(`[error] ${s}`),
    debug: (s: string) => fake.log.push(s),
    trace: (s: string) => fake.log.push(s),
    show: () => void fake.logShown++,
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
  createWebviewPanel: (viewType: string, title: string, _column: unknown, options: any) => makePanel(viewType, title, options),
  registerWebviewPanelSerializer: (viewType: string, serializer: { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> }) => {
    fake.serializers.set(viewType, serializer);
    return disposable;
  },
  registerFileDecorationProvider: (provider: { provideFileDecoration(uri: Uri): FileDecoration | undefined }) => {
    fake.decorations = provider;
    return disposable;
  },
  showWarningMessage: async (message: string, options: any, ...items: string[]) => {
    fake.warnings.push({ message, options, items });
    return fake.warningAnswer;
  },
  showErrorMessage: async (msg: string, ..._items: string[]) => {
    fake.errors.push(msg);
    return fake.errorAnswer;
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

export const version = '1.99.0-test';

export const env = {
  appName: 'Fake Code',
  /** Idioma del editor. Los tests van en castellano salvo que digan otra cosa. */
  language: 'es',
  clipboard: { writeText: async (s: string) => void (fake.clipboard = s) },
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
    update: async (key: string, value: unknown, target: unknown) => {
      fake.config[key] = value;
      fake.configUpdates.push({ key, value, target });
    },
  }),
  fs: {
    delete: async (uri: Uri, options: any) => void fake.deleted.push({ path: uri.path, options }),
  },
  isTrusted: true,
  onDidGrantWorkspaceTrust: (fn: () => unknown) => {
    fake.trustListeners.push(fn);
    return disposable;
  },
  onDidChangeConfiguration: (fn: (e: { affectsConfiguration(k: string): boolean }) => unknown) => {
    fake.configListeners.push(fn);
    return disposable;
  },
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
    extensionUri: Uri.file('/ext/heft'),
    workspaceState: {
      get: (k: string) => fake.state.get(k),
      update: async (k: string, v: unknown) => void fake.state.set(k, v),
    },
  };
}
