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
        this.state = value;
      }),
      lumine.config.observe("linter-todo.severity", (value) => {
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
    const keywords = this.keywords?.filter((keyword) => keyword.length > 0);
    if (!keywords || !keywords.length) {
      this.regex = null;
      return;
    }
    const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
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
      return notebookEditor ? this.lintNotebook(notebookEditor) : [];
    }

    if (!editor.getPath()) return [];
    const knownExt = getKnownExtension(editor.getPath());
    if (!knownExt && editor.getBuffer().getLanguageMode().asynchronousSyntax) {
      const messages = [];
      return editor
        .analyzeSyntax(
          require.resolve("./syntax-analysis"),
          "lint",
          { source: this.regex.source, flags: this.regex.flags, severity: this.severity },
          {
            signal,
            onChunk: (packet) => {
              for (const message of packet) messages.push(message);
            },
          },
        )
        .then((summary) => {
          if (!summary) return null;
          if (summary.count !== messages.length)
            throw new Error("Incomplete TODO diagnostic stream");
          return messages;
        });
    }
    return require("./syntax-analysis").collect(editor, this.regex, this.severity);
  },

  lintNotebook(notebookEditor) {
    const cells = notebookEditor.document?.cells;
    if (!cells) return [];

    const filePath = notebookEditor.getPath?.();
    if (!filePath) return [];
    const messages = [];
    const regex = new RegExp(this.regex.source, this.regex.flags);

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.type !== "code" || !cell.source) continue;

      const cellNumber = i + 1;
      const lines = cell.source.split("\n");

      for (let row = 0; row < lines.length; row++) {
        const line = lines[row];
        regex.lastIndex = 0;
        let match;

        while ((match = regex.exec(line)) !== null) {
          const col = match.index;

          // Must be inside a Python comment: # appears before the keyword on the same line
          const commentStart = line.indexOf("#");
          if (commentStart === -1 || commentStart >= col) continue;

          const keyword = match[1];
          const afterKeyword = line.substring(col + keyword.length);
          const textInAfter = afterKeyword.replace(/^:\s*/, "").trimStart();
          const text = textInAfter.trimEnd();

          const code = line
            .substring(0, col)
            .replace(/[\s#/*!<>-]+$/, "")
            .trim();

          let excerpt;
          if (text && code) excerpt = `${keyword}: ${text}, \`${code}\``;
          else if (text) excerpt = `${keyword}: ${text}`;
          else if (code) excerpt = `${keyword}: \`${code}\``;
          else excerpt = keyword;

          // The cell number alone: jupyter-view projects the message onto
          // every split view's own cell buffer, so a buffer named here would
          // tie the message to one view.
          messages.push({
            severity: this.severity,
            excerpt,
            location: {
              file: filePath,
              cell: cellNumber,
              position: [
                [row, col],
                [row, col + keyword.length],
              ],
            },
          });
        }
      }
    }

    return messages;
  },
};
