const { CompositeDisposable, Disposable } = require("lumine");
const indie = require("./indie");
const { buildCommentRegions, getKnownExtension, isInComment } = require("./comment-regions");

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
      lumine.config.observe("linter-todo.state", (value) => {
        this.state = value;
      }),
      lumine.config.observe("linter-todo.severity", (value) => {
        this.severity = value;
      }),
      lumine.config.observe("linter-todo.keywords", (value) => {
        this.keywords = value;
        this.buildRegex();
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
          didDispatch: () => {
            indie.runScan();
          },
        },
        // The tree view is inside the workspace, so its context menu reaches
        // this handler on its own. A second registration on .tree-view would
        // run the scan twice for every dispatch from there.
        "linter-todo:lint-selected": {
          description: "Scan the selected files for TODO markers.",
          didDispatch: () => {
            indie.runSelectedScan();
          },
        },
      }),
    );
  },

  deactivate() {
    indie.dispose();
    this.disposables.dispose();
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
    indie.setBusySignal(busySignal);
    return new Disposable(() => {
      if (indie.busySignal === busySignal) indie.setBusySignal(null);
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

  lint(editor) {
    if (!this.state || !this.regex) return [];

    // The shared source editor behind a notebook's split views: its buffer
    // holds the JSON projection, so the notebook's cells are scanned in its
    // place. All views share one document, so any of them answers for it.
    if (editor.isJupyterNotebookSourceEditor) {
      const notebookEditor = editor.getJupyterNotebookEditors?.()[0];
      return notebookEditor ? this.lintNotebook(notebookEditor) : [];
    }

    const filePath = editor.getPath();
    if (!filePath) return [];

    const messages = [];
    const knownExt = getKnownExtension(filePath);
    let commentRegions;

    editor.scan(this.regex, ({ match, range }) => {
      // Most buffers contain no keywords. Build the full comment map only if
      // there is a match to classify, then reuse it for the remaining matches.
      if (knownExt && commentRegions === undefined) {
        commentRegions = buildCommentRegions(editor.getBuffer().getLines(), knownExt);
      }
      if (!this.isCommentPosition(editor, commentRegions, range.start)) return;

      const keyword = match[1];
      const lineText = editor.lineTextForBufferRow(range.start.row);
      const afterKeyword = lineText.substring(range.end.column);
      const textInAfter = afterKeyword.replace(/^:\s*/, "").trimStart();
      const textStartColumn = range.end.column + (afterKeyword.length - textInAfter.length);
      let text = textInAfter.trimEnd();

      let nextRow = range.start.row + 1;
      while (text) {
        const nextLine = editor.lineTextForBufferRow(nextRow);
        if (nextLine == null) break;
        const charAtCol = nextLine[textStartColumn];
        if (!charAtCol || charAtCol === " " || charAtCol === "\t") break;
        if (!this.isCommentPosition(editor, commentRegions, [nextRow, textStartColumn])) break;
        text += " " + nextLine.substring(textStartColumn).trim();
        nextRow++;
      }

      const code = lineText
        .substring(0, range.start.column)
        .replace(/[\s#/*!<>-]+$/, "")
        .trim();

      let excerpt;
      if (text && code) excerpt = `${keyword}: ${text}, \`${code}\``;
      else if (text) excerpt = `${keyword}: ${text}`;
      else if (code) excerpt = `${keyword}: \`${code}\``;
      else excerpt = keyword;

      messages.push({
        severity: this.severity,
        excerpt,
        location: {
          file: filePath,
          position: [
            [range.start.row, range.start.column],
            [range.end.row, range.end.column],
          ],
        },
      });
    });

    return messages;
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
