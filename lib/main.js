const { CompositeDisposable, Disposable } = require("lumine");
const indie = require("./indie");
const { getKnownExtension, isInComment } = require("./comment-regions");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "linter-todo",
      tips: [
        "Your TODO and FIXME comments are reported as linter messages, so they are easy to find again.",
      ],
    };
  },

  activate() {
    this.budgetWarnings = new WeakMap();
    this.scanGeneration = (this.scanGeneration ?? 0) + 1;
    this.pendingSyntax = new Set();
    this.disposables = new CompositeDisposable();
    this.busyConnections = new Set();
    const treeSelection = { providers: new Map(), nextOrder: 0, disposed: false };
    this.treeSelection = treeSelection;
    this.disposables.add(
      new Disposable(() => {
        treeSelection.disposed = true;
        treeSelection.providers.clear();
        if (this.treeSelection === treeSelection) {
          this.treeSelection = null;
          indie.setTreeView(null);
        }
      }),
    );

    this.disposables.add(
      lumine.workspace.observeTextEditors((editor) => {
        const local = new CompositeDisposable(
          editor.onDidChangeGrammar(() => indie.cancelScanForEditor(editor)),
          editor.onDidDestroy(() => {
            this.disposables.remove(local);
            local.dispose();
          }),
        );
        this.disposables.add(local);
        indie.cancelScanForEditor(editor);
      }),
      lumine.project.onWillChangeState(() => indie.cancelScan()),
      lumine.project.onDidChangePaths(() => indie.cancelScan()),
      lumine.config.observe("linter-todo.state", (value) => {
        this.cancelProviderScans();
        this.state = value;
      }),
      lumine.config.observe("linter-todo.severity", (value) => {
        this.cancelProviderScans();
        this.severity = value;
      }),
      lumine.config.observe("linter-todo.keywords", (value) => {
        this.keywords = value;
        this.buildRegex();
        lumine.commands.invalidateAvailability();
      }),
      lumine.commands.add("lumine-workspace", {
        "linter-todo:toggle-state": {
          description: "Turn the TODO scan on or off.",
          didDispatch: () => {
            lumine.config.set("linter-todo.state", !this.state);
          },
        },
        "linter-todo:lint-projects": {
          description: "Scan every file in the project folders for TODO markers.",
          isAvailable: () => this.canScan(false),
          didDispatch: () => {
            indie.runScan();
          },
        },
      }),
      lumine.commands.add(".tree-view", {
        "linter-todo:lint-selected": {
          description: "Scan the selected files for TODO markers.",
          isAvailable: () => this.canScan(true),
          didDispatch: () => {
            indie.runSelectedScan();
          },
        },
      }),
    );
  },

  canScan(selected = false) {
    if (!indie.indieDelegate || indie.scanning || !this.regex) return false;
    return selected
      ? Boolean(indie.treeView?.getSelectionSnapshot?.().count)
      : lumine.project.getPaths().length > 0;
  },

  deactivate() {
    this.cancelProviderScans();
    this.busyConnections?.clear();
    this.busyConnections = null;
    indie.dispose();
    this.disposables?.dispose();
  },

  provideLinter() {
    return {
      name: "TODO",
      scope: "file",
      lintsOnChange: true,
      grammarScopes: ["*"],
      lint: this.lint.bind(this),
    };
  },

  consumeLinterRegistry(registerIndie) {
    const delegate = registerIndie({
      name: "TODO/Project",
      deleteOnOpen: true,
    });
    indie.register(delegate, this);
    const registration = new Disposable(() => {
      delegate.dispose();
      if (indie.indieDelegate === delegate) indie.register(null, null);
    });
    this.disposables.add(registration);
    return registration;
  },

  consumeBusySignal(busySignal) {
    const connections = this.busyConnections;
    if (!connections) return new Disposable();
    const edge = { service: busySignal };
    connections.add(edge);
    indie.setBusySignal(busySignal);
    return new Disposable(() => {
      if (!connections.delete(edge) || this.busyConnections !== connections) return;
      const current = [...connections].at(-1)?.service ?? null;
      if (indie.busySignal !== current) indie.setBusySignal(current);
    });
  },

  consumeTreeViewSelection(treeView) {
    const state = this.treeSelection;
    if (!state || state.disposed) return new Disposable(() => {});
    let leases = state.providers.get(treeView);
    if (!leases) {
      leases = new Set();
      state.providers.set(treeView, leases);
    }
    const lease = { order: ++state.nextOrder };
    leases.add(lease);
    this.updateTreeViewSelection(state);
    const registration = new Disposable(() => {
      if (state.disposed || this.treeSelection !== state || !leases.delete(lease)) return;
      if (leases.size === 0) state.providers.delete(treeView);
      this.updateTreeViewSelection(state);
    });
    this.disposables.add(registration);
    return registration;
  },

  updateTreeViewSelection(state) {
    let latest = 0;
    let selection = null;
    // Shared payloads remain usable until their final lease disappears. Track
    // each edge's order so A, B, A falls back to B when the newest A retires.
    for (const [provider, leases] of state.providers) {
      for (const lease of leases) {
        if (lease.order > latest) {
          latest = lease.order;
          selection = provider;
        }
      }
    }
    indie.setTreeView(selection);
  },

  buildRegex() {
    this.cancelProviderScans();
    const keywords = this.keywords?.filter((keyword) => keyword.length > 0);
    if (!keywords || !keywords.length) {
      this.regex = null;
      return;
    }
    const escaped = [];
    this.keywordLength = 0;
    let units = 0,
      excessive = false;
    for (const keyword of keywords) {
      if (keyword.length > 4096 || /[\r\n]/.test(keyword)) {
        excessive = true;
        break;
      }
      const value = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      units += value.length + 1;
      if (units > 65536) {
        excessive = true;
        break;
      }
      escaped.push(value);
      this.keywordLength = Math.max(this.keywordLength, keyword.length);
    }
    if (excessive) {
      this.regex = null;
      lumine.notifications.addWarning("TODO keyword configuration exceeds its input budget", {
        detail:
          "Use single-line keywords up to 4096 UTF-16 units each and at most 65536 units in the combined expression.",
        dismissable: true,
      });
      return;
    }
    this.regex = new RegExp(`\\b(${escaped.join("|")})\\b`, "g");
  },

  isCommentPosition(editor, commentRegions, position) {
    const row = Array.isArray(position) ? position[0] : position.row;
    const column = Array.isArray(position) ? position[1] : position.column;

    if (commentRegions !== undefined) {
      return isInComment(commentRegions, row, column);
    }

    const scopes = editor.scopeDescriptorForBufferPosition(position).getScopesArray();
    return scopes.some((s) => s.startsWith("comment") || s === "text.plain");
  },

  lint(editor, { signal } = {}) {
    if (signal?.aborted) return null;
    if (editor.getGrammar?.() === lumine.grammars.nullGrammar) return [];
    if (!this.state || !this.regex) return [];

    // The shared source editor behind a notebook's split views: its buffer
    // holds the JSON projection, so the notebook's cells are scanned in its
    // place. All views share one document, so any of them answers for it.
    if (editor.isJupyterNotebookSourceEditor) {
      const notebookEditor = editor.getJupyterNotebookEditors?.()[0];
      return notebookEditor
        ? this.lintNotebook(notebookEditor, { signal }).catch((error) =>
            this.lintFailure(error, editor),
          )
        : [];
    }

    if (!editor.getPath()) return [];
    const generation = this.scanGeneration;
    const knownExt = getKnownExtension(editor.getPath());
    if (!knownExt && editor.getBuffer().getLanguageMode().asynchronousSyntax) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      this.pendingSyntax.add(controller);
      const messages = [];
      return editor
        .analyzeSyntax(
          require.resolve("./syntax-analysis"),
          "lint",
          {
            source: this.regex.source,
            flags: this.regex.flags,
            severity: this.severity,
            keywordLength: this.keywordLength,
          },
          {
            signal: controller.signal,
            onChunk: (packet) => {
              if (messages.length + packet.length > require("./source-scanner").MAX_MESSAGES)
                throw require("./source-scanner").budgetError();
              for (const message of packet) messages.push(message);
            },
          },
        )
        .then((summary) => {
          if (!summary || this.scanGeneration !== generation) return null;
          if (summary.count !== messages.length)
            throw new Error("Incomplete TODO diagnostic stream");
          return messages;
        })
        .catch((error) => this.lintFailure(error, editor))
        .finally(() => {
          signal?.removeEventListener("abort", abort);
          this.pendingSyntax.delete(controller);
        });
    }
    try {
      const result = require("./syntax-analysis").collect(editor, this.regex, this.severity, {
        signal,
        keywordLength: this.keywordLength,
        isCurrent: () => this.scanGeneration === generation,
      });
      return result?.then ? result.catch((error) => this.lintFailure(error, editor)) : result;
    } catch (error) {
      return this.lintFailure(error, editor);
    }
  },

  lintFailure(error, editor) {
    if (error.name === "AbortError") return null;
    if (error.code !== "ERR_TODO_RESULTS_LIMIT") throw error;
    const revision = editor.getBuffer?.().getTextRevision();
    if (this.budgetWarnings.get(editor) !== revision || !this.budgetWarnings.has(editor)) {
      this.budgetWarnings.set(editor, revision);
      lumine.notifications.addWarning("TODO results exceed the diagnostic budget", {
        detail: error.message,
        dismissable: true,
      });
    }
    return [];
  },

  cancelProviderScans() {
    this.scanGeneration = (this.scanGeneration ?? 0) + 1;
    for (const controller of this.pendingSyntax ?? []) controller.abort();
    this.pendingSyntax?.clear();
  },

  async lintNotebook(notebookEditor, { signal } = {}) {
    const generation = this.scanGeneration,
      regex = this.regex,
      severity = this.severity;
    const cells = notebookEditor.document?.cells;
    const filePath = notebookEditor.getPath?.();
    if (!cells || !filePath) return [];
    const { collectSource, MAX_MESSAGES, budgetError } = require("./source-scanner");
    const { TextBuffer } = require("lumine");
    const captured = cells.slice();
    const captureSource = (cell) => {
      if (cell.getSourceSnapshot) {
        const source = cell.getSourceSnapshot();
        return { source, current: () => source.equals(cell.getSourceSnapshot()) };
      }
      const text = Object.getOwnPropertyDescriptor(cell, "source")?.value;
      if (typeof text !== "string")
        throw new Error(
          "Notebook cells must provide immutable source snapshots or string data fields.",
        );
      return {
        source: TextBuffer.createTextSnapshot(text),
        current: () => Object.getOwnPropertyDescriptor(cell, "source")?.value === text,
      };
    };
    const inputs = [],
      messages = [];
    let deadline = performance.now() + 4;
    for (let index = 0; index < captured.length; index++) {
      signal?.throwIfAborted();
      const cell = captured[index];
      if (cell.type !== "code") continue;
      const { source, current: sameSource } = captureSource(cell);
      inputs.push({ cell, sameSource, index });
      const current = () =>
        this.scanGeneration === generation &&
        notebookEditor.document?.cells === cells &&
        cells[index] === cell &&
        sameSource();
      const found = await collectSource(source, {
        regex,
        severity,
        filePath,
        extension: ".py",
        keywordLength: this.keywordLength,
        signal,
        isCurrent: current,
      });
      if (messages.length + found.length > MAX_MESSAGES) throw budgetError();
      for (const message of found) {
        message.location.cell = index + 1;
        messages.push(message);
      }
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setImmediate(resolve));
        deadline = performance.now() + 4;
      }
    }
    signal?.throwIfAborted();
    if (
      notebookEditor.document?.cells !== cells ||
      this.scanGeneration !== generation ||
      cells.length !== captured.length ||
      inputs.some(({ cell, sameSource, index }) => cells[index] !== cell || !sameSource())
    )
      return null;
    return messages;
  },
};
