const fs = require("fs");
const os = require("os");
const path = require("path");

// The module exports a singleton, not the class.
const linter = require("../lib/indie");

function buildFixture() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "linter-todo-crawl-")));
  fs.writeFileSync(path.join(dir, "index.js"), "// TODO: one\n");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "app.js"), "// TODO: two\n");
  fs.writeFileSync(path.join(dir, "notes.bin"), "// TODO: unknown extension\n");
  // ripgrep only consults `.gitignore` inside a repository, so the fixture
  // needs to look like one.
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "config"), "[core]\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "build/\n");
  fs.mkdirSync(path.join(dir, "build"));
  fs.writeFileSync(path.join(dir, "build", "bundle.js"), "// TODO: generated\n");
  fs.mkdirSync(path.join(dir, "vendor"));
  fs.writeFileSync(path.join(dir, "vendor", "lib.js"), "// TODO: vendored\n");
  return dir;
}

function relativize(dir, paths) {
  return new Set(paths.map((p) => path.relative(dir, p).split(path.sep).join("/")));
}

describe("linter-todo file collection", () => {
  let dir;

  beforeEach(async () => {
    const textGrammarPackage = await lumine.packages.activatePackage("language-text");
    await textGrammarPackage.resourceLoadPromise;
    dir = buildFixture();
    lumine.config.set("linter-todo.excludeVcsIgnoredPaths", true);
  });

  it("collects the scannable files under a directory", async () => {
    const files = relativize(dir, await linter.collectFiles([dir], [], null));

    expect(files.has("index.js")).toBe(true);
    expect(files.has("src/app.js")).toBe(true);
  });

  it("skips files whose extension it cannot parse comments for", async () => {
    const files = relativize(dir, await linter.collectFiles([dir], [], null));

    expect(files.has("notes.bin")).toBe(false);
  });

  it("skips VCS-ignored files by default", async () => {
    const files = relativize(dir, await linter.collectFiles([dir], [], null));

    expect(files.has("build/bundle.js")).toBe(false);
  });

  it("includes VCS-ignored files when the setting is off", async () => {
    lumine.config.set("linter-todo.excludeVcsIgnoredPaths", false);
    const files = relativize(dir, await linter.collectFiles([dir], [], null));

    expect(files.has("build/bundle.js")).toBe(true);
  });

  it("applies the ignored names", async () => {
    const files = relativize(dir, await linter.collectFiles([dir], ["vendor"], null));

    expect(files.has("index.js")).toBe(true);
    expect(files.has("vendor/lib.js")).toBe(false);
  });

  it("applies the whole-path ignore glob", async () => {
    const glob = `${dir.replace(/\\/g, "/")}/src/**`;
    const files = relativize(dir, await linter.collectFiles([dir], [], glob));

    expect(files.has("index.js")).toBe(true);
    expect(files.has("src/app.js")).toBe(false);
  });

  it("drops a target the ignore glob excludes outright", async () => {
    const glob = `${dir.replace(/\\/g, "/")}/**`;

    expect(await linter.collectFiles([dir], [], glob)).toEqual([]);
  });

  it("takes an explicit file target as given", async () => {
    const target = path.join(dir, "build", "bundle.js");

    expect(await linter.collectFiles([target], [], null)).toEqual([target]);
  });

  it("skips an open file with None even when explicitly selected", async () => {
    const filePath = path.join(dir, "index.js");
    const editor = await lumine.workspace.open(filePath);
    const grammar = editor.getGrammar();
    try {
      editor.setGrammar(lumine.grammars.nullGrammar);
      expect(await linter.collectFiles([filePath], [], null)).toEqual([]);
      editor.setGrammar(grammar);
      expect(await linter.collectFiles([filePath], [], null)).toEqual([filePath]);
    } finally {
      editor.destroy();
    }
  });

  it("skips a closed None association and honors an explicit real grammar", async () => {
    const previous = lumine.config.get("core.customFileTypes");
    const filePath = path.join(dir, "index.js");
    let editor;
    try {
      lumine.config.set("core.customFileTypes", {
        [lumine.grammars.nullGrammar.scopeName]: ["js"],
      });
      expect(await linter.collectFiles([filePath], [], null)).toEqual([]);
      editor = await lumine.workspace.open(filePath);
      lumine.grammars.assignGrammar(editor, lumine.grammars.grammarForScopeName("text.plain"));
      expect(await linter.collectFiles([filePath], [], null)).toEqual([filePath]);
    } finally {
      editor?.destroy();
      if (previous === undefined) lumine.config.unset("core.customFileTypes");
      else lumine.config.set("core.customFileTypes", previous);
    }
  });

  it("ignores a target that cannot be read", async () => {
    expect(await linter.collectFiles([path.join(dir, "nope")], [], null)).toEqual([]);
  });
});
