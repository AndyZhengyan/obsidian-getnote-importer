// Minimal obsidian module mock for unit testing plugins.
// Provides just enough surface to let code that imports from
// "obsidian" compile and run in Node.

// ---- Events ----
export class Events {
  private _listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  on(name: string, callback: (...args: unknown[]) => void) {
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    this._listeners.get(name)!.add(callback);
  }

  off(name: string, callback: (...args: unknown[]) => void) {
    this._listeners.get(name)?.delete(callback);
  }

  trigger(name: string, ...args: unknown[]) {
    this._listeners.get(name)?.forEach((fn) => fn(...args));
  }
}

// ---- Vault ----
export class Vault extends Events {
  adapter = { getName: () => 'mock' };
  createFolder = async (_path: string) => {};
  create = async (_path: string, _data: string) => {};
  modify = async (_file: unknown, _data: string) => {};
  getAbstractFileByPath(_path: string): unknown { return null; }
}

// ---- Workspace ----
export class Workspace extends Events {}

// ---- MetadataCache ----
export class MetadataCache extends Events {
  getFileCache(_file: unknown) { return null; }
}

// ---- TFile ----
export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;

  constructor(path: string) {
    this.path = path;
    const parts = path.split('/');
    this.name = parts[parts.length - 1];
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.extension = this.name.includes('.') ? this.name.split('.').pop()! : '';
  }
}

// ---- TFolder ----
export class TFolder {
  path: string;
  name: string;
  children: unknown[] = [];
  isRoot(): boolean { return this.path === '/'; }
}

// ---- App ----
export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new MetadataCache();
}

// ---- Plugin ----
export class Plugin {
  app: App;
  manifest = { id: 'test-plugin', name: 'Test Plugin', version: '0.1.0' };

  constructor(app: App) {
    this.app = app;
  }

  loadData(): Promise<Record<string, unknown>> { return Promise.resolve({}); }
  saveData(_data: Record<string, unknown>): Promise<void> { return Promise.resolve(); }
}

// ---- Modal ----
export class Modal {
  app: App;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  modalEl: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.titleEl = document.createElement('div');
    this.contentEl = document.createElement('div');
    this.modalEl = document.createElement('div');
    this.modalEl.appendChild(this.titleEl);
    this.modalEl.appendChild(this.contentEl);
  }

  open() {}
  close() {}
}

// ---- Notice ----
export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

// ---- Setting ----
export class Setting {
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string): this { return this; }
  setDesc(_desc: string): this { return this; }
  addButton(_cb: (b: ButtonComponent) => void): this { return this; }
  addText(_cb: (t: TextComponent) => void): this { return this; }
  addToggle(_cb: (t: ToggleComponent) => void): this { return this; }
  addDropdown(_cb: (d: DropdownComponent) => void): this { return this; }
  addSlider(_cb: (s: SliderComponent) => void): this { return this; }
}

export class ButtonComponent {
  setButtonText(_text: string): this { return this; }
  onClick(_fn: () => void): this { return this; }
  setCta(): this { return this; }
  setWarning(): this { return this; }
}

export class TextComponent {
  setValue(_value: string): this { return this; }
  onChange(_fn: (value: string) => void): this { return this; }
  setPlaceholder(_text: string): this { return this; }
}

export class ToggleComponent {
  setValue(_value: boolean): this { return this; }
  onChange(_fn: (value: boolean) => void): this { return this; }
}

export class DropdownComponent {
  addOption(_value: string, _label: string): this { return this; }
  setValue(_value: string): this { return this; }
  onChange(_fn: (value: string) => void): this { return this; }
}

export class SliderComponent {
  setValue(_value: number): this { return this; }
  onChange(_fn: (value: number) => void): this { return this; }
  setLimits(_min: number, _max: number, _step: number): this { return this; }
}

// ---- PluginSettingTab ----
export class PluginSettingTab {
  app: App;
  containerEl: HTMLElement;
  plugin: Plugin;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
  }
}

// ---- Utilities ----
export function normalizePath(path: string): string {
  return path.replace(/\/+/g, '/');
}

export function getLanguage(): string {
  return 'zh-CN';
}

export async function requestUrl(_request: unknown): Promise<{
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
  arrayBuffer: ArrayBuffer;
}> {
  return {
    status: 200,
    headers: {},
    text: '',
    json: null,
    arrayBuffer: new ArrayBuffer(0),
  };
}

// ---- AbstractInputSuggest (minimal stub for FolderSuggest tests) ----
export abstract class AbstractInputSuggest<T> {
  constructor(_app: unknown, _inputEl: HTMLElement) {}
  abstract getSuggestions(_query: string): T[];
  abstract renderSuggestion(_value: T, _el: HTMLElement): void;
  selectSuggestion(_value: T, _evt: MouseEvent | KeyboardEvent): void {}
  close(): void {}
  setValue(_value: string): void {}
  getValue(): string { return ''; }
  onSelect(_cb: (value: T, evt: MouseEvent | KeyboardEvent) => void): this { return this; }
}
