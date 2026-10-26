const { TextBuffer } = require("lumine");
const path = require("node:path");

describe("TODO source scanning", () => {
  const scan = (text, extension = ".txt", extra = {}) => {
    const source = typeof text === "string" ? TextBuffer.createTextSnapshot(text) : text;
    return require("../lib/source-scanner").collectSource(source, {
      regex: /\b(TODO|FIXME)\b/g,
      keywordLength: 5,
      severity: "hint",
      filePath: `sample${extension}`,
      extension,
      ...extra,
    });
  };
  beforeEach(() => jasmine.useRealClock());

  it("reads giant rows in bounded windows and retains exact positions with elided excerpts", async () => {
    const source = TextBuffer.createTextSnapshot(
      "// " + "x".repeat(1024 * 1024) + " TODO: " + "z".repeat(10000),
    );
    const wrapped = { length: source.length, lineCount: source.lineCount };
    for (const name of ["positionAt", "lineStart", "charCodeAt"])
      wrapped[name] = source[name].bind(source);
    wrapped.slice = jasmine.createSpy("bounded read").and.callFake((start, end) => {
      expect(end - start).toBeLessThan(65536);
      return source.slice(start, end);
    });
    const [message] = await scan(wrapped, ".js");
    expect(message.location.position).toEqual([
      [0, 1024 * 1024 + 4],
      [0, 1024 * 1024 + 8],
    ]);
    expect(message.excerpt.length).toBeLessThanOrEqual(1025);
    expect(message.excerpt).toContain("…");
  });

  it("matches tokens and comment delimiters across source window boundaries", async () => {
    const text =
      " ".repeat(32767) + "TODO one\n" + " ".repeat(32756) + "<!-- FIXME two --> TODO outside";
    expect((await scan(text, ".txt")).map((message) => message.location.position[0])).toEqual([
      [0, 32767],
      [1, 32761],
      [1, 32775],
    ]);
    expect((await scan(text, ".html")).map((message) => message.location.position[0])).toEqual([
      [1, 32761],
    ]);
  });

  it("retains the existing comment classification across deterministic mixed inputs", async () => {
    const { buildCommentRegions, isInComment } = require("../lib/comment-regions");
    let seed = 11237;
    const pieces = [
      "TODO",
      "FIXME",
      " ",
      "a",
      "\n",
      "\r\n",
      "/*",
      "*/",
      "//",
      "#",
      "<!--",
      "-->",
      "!",
      "$",
      '"',
    ];
    for (const extension of [".js", ".py", ".html", ".dat"])
      for (let test = 0; test < 20; test++) {
        let text = "";
        for (let index = 0; index < 80; index++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          text += pieces[seed % pieces.length];
        }
        const source = TextBuffer.createTextSnapshot(text);
        const regions = buildCommentRegions(text.split("\n"), extension);
        const expected = [...text.matchAll(/\b(TODO|FIXME)\b/g)]
          .filter((match) => {
            const point = source.positionAt(match.index);
            return isInComment(regions, point.row, point.column);
          })
          .map((match) => {
            const point = source.positionAt(match.index);
            return [point.row, point.column];
          });
        expect((await scan(source, extension)).map((message) => message.location.position[0]))
          .withContext(extension + " " + test)
          .toEqual(expected);
      }
  });

  it("cancels sparse scans and refuses dense diagnostic results without a partial list", async () => {
    const controller = new AbortController();
    const pending = scan("x".repeat(4 * 1024 * 1024), ".txt", { signal: controller.signal });
    controller.abort();
    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ name: "AbortError" }));
    await expectAsync(scan("TODO\n".repeat(10001))).toBeRejectedWith(
      jasmine.objectContaining({ code: "ERR_TODO_RESULTS_LIMIT" }),
    );
  });
});

describe("TODO large-source provider ownership", () => {
  let main, editor;
  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("language-text");
    main = (await lumine.packages.activatePackage("linter-todo")).mainModule;
    editor = lumine.workspace.buildTextEditor();
    editor.getBuffer().setPath(path.join(lumine.getConfigDirPath(), "large-todo.txt"));
    editor.setGrammar(lumine.grammars.grammarForScopeName("text.plain"));
    lumine.config.set("linter-todo.keywords", ["TODO"]);
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("linter-todo");
  });

  it("uses canonical notebook snapshots without invoking source getters", async () => {
    const source = TextBuffer.createTextSnapshot("# " + "x".repeat(1024 * 1024) + " TODO: cell");
    const cell = { type: "code", getSourceSnapshot: () => source };
    Object.defineProperty(cell, "source", {
      get() {
        throw new Error("large cell source getter");
      },
    });
    const item = { document: { cells: [cell] }, getPath: () => "large.ipynb" };
    const messages = await main.lintNotebook(item);
    expect(messages.length).toBe(1);
    expect(messages[0].location.cell).toBe(1);
  });

  it("clears over-budget results, reports once per revision and resumes after shrinking", async () => {
    editor.setText("TODO\n".repeat(10001));
    const warning = spyOn(lumine.notifications, "addWarning").and.callThrough();
    spyOn(editor.getBuffer(), "getLines").and.throwError("whole row array");
    spyOn(editor, "getText").and.throwError("whole document");
    expect(await main.lint(editor)).toEqual([]);
    expect(await main.lint(editor)).toEqual([]);
    expect(warning).toHaveBeenCalledTimes(1);
    editor.setText("TODO: current");
    expect((await main.lint(editor)).map((message) => message.excerpt)).toEqual(["TODO: current"]);
  });

  it("discards an asynchronous source scan after its keyword configuration changes", async () => {
    editor.setText("x".repeat(2 * 1024 * 1024) + " TODO: old query");
    const pending = main.lint(editor);
    lumine.config.set("linter-todo.keywords", ["FIXME"]);
    expect(await pending).toBeNull();
    expect(await main.lint(editor)).toEqual([]);
  });
});
