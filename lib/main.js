const { CompositeDisposable, Disposable } = require("atom");
const indie = require("./indie");
const { buildCommentRegions, getKnownExtension, isInComment } = require("./comment-regions");

module.exports = {
  activate() {
    this.disposables = new CompositeDisposable();

    this.disposables.add(
      atom.config.observe("linter-todo.state", (value) => {
        this.state = value;
      }),
      atom.config.observe("linter-todo.keywords", (value) => {
        this.keywords = value;
        this.buildRegex();
      }),
      atom.commands.add("atom-workspace", {
        "linter-todo:toggle-state": () => {
          atom.config.set("linter-todo.state", !this.state);
        },
        "linter-todo:lint-projects": () => {
          indie.runScan();
        },
        "linter-todo:lint-selected": () => {
          indie.runSelectedScan();
        },
      }),
      atom.commands.add(".tree-view", {
        "linter-todo:lint-selected": () => {
          indie.runSelectedScan();
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
    this.disposables.add(delegate);
    indie.register(delegate, this);
  },

  consumeBusySignalReporter(busySignal) {
    indie.setBusySignal(busySignal);
  },

  consumeTreeView(treeView) {
    indie.setTreeView(treeView);
    return new Disposable(() => {
      indie.setTreeView(null);
    });
  },

  buildRegex() {
    if (!this.keywords || !this.keywords.length) {
      this.regex = null;
      return;
    }
    const escaped = this.keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
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

    const notebookEditor = editor.jupyterNotebookEditor;
    if (notebookEditor) return this.lintNotebook(notebookEditor);

    const filePath = editor.getPath();
    if (!filePath) return [];

    const messages = [];
    const knownExt = getKnownExtension(filePath);
    const commentRegions = knownExt
      ? buildCommentRegions(editor.getBuffer().getLines(), knownExt)
      : undefined;

    editor.scan(this.regex, ({ match, range }) => {
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
        severity: "info",
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

          const cellEditor = notebookEditor.getCellEditor(cellNumber);
          const cellBuffer = cellEditor?.getBuffer();

          const location = {
            file: filePath,
            cell: cellNumber,
            position: [
              [row, col],
              [row, col + keyword.length],
            ],
          };
          if (cellBuffer) {
            location.buffer = cellBuffer;
          }

          messages.push({ severity: "info", excerpt, location });
        }
      }
    }

    return messages;
  },
};
