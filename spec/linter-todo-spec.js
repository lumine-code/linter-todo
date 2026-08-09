const path = require("path");

describe("linter-todo", () => {
  let mainModule, workspaceElement;

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);

    // The package defers activation until one of its commands is dispatched.
    const activation = lumine.packages.activatePackage("linter-todo");
    lumine.commands.dispatch(workspaceElement, "linter-todo:lint-projects");
    mainModule = (await activation).mainModule;
  });

  describe("linter provider", () => {
    it("exposes the shape expected by the linter service", () => {
      const provider = mainModule.provideLinter();
      expect(provider.name).toBe("TODO");
      expect(provider.scope).toBe("file");
      expect(provider.lintsOnChange).toBe(true);
      expect(provider.grammarScopes).toEqual(["*"]);
      expect(typeof provider.lint).toBe("function");
    });
  });

  describe("lint()", () => {
    let editor;

    beforeEach(async () => {
      editor = await lumine.workspace.open(path.join(__dirname, "fixtures", "sample.js"));
    });

    it("reports keywords found in comments and skips code occurrences", () => {
      const messages = mainModule.provideLinter().lint(editor);

      expect(messages.length).toBe(2);

      expect(messages[0].severity).toBe("hint");
      expect(messages[0].excerpt).toBe("TODO: implement feature");
      expect(messages[0].location.file).toBe(editor.getPath());
      expect(messages[0].location.position).toEqual([
        [0, 3],
        [0, 7],
      ]);

      expect(messages[1].excerpt).toBe("FIXME: broken, `const x = 1;`");
      expect(messages[1].location.position).toEqual([
        [1, 16],
        [1, 21],
      ]);
    });

    it("honors the configured keyword list", () => {
      lumine.config.set("linter-todo.keywords", ["FIXME"]);
      const messages = mainModule.provideLinter().lint(editor);
      expect(messages.length).toBe(1);
      expect(messages[0].excerpt).toContain("FIXME");
    });

    it("honors the configured severity", () => {
      lumine.config.set("linter-todo.severity", "warning");
      const messages = mainModule.provideLinter().lint(editor);

      expect(messages.length).toBe(2);
      expect(messages.map((message) => message.severity)).toEqual(["warning", "warning"]);
    });

    it("returns an empty list when the linter state is disabled", () => {
      lumine.config.set("linter-todo.state", false);
      expect(mainModule.provideLinter().lint(editor)).toEqual([]);
    });

    it("returns an empty list when no keywords are configured", () => {
      lumine.config.set("linter-todo.keywords", []);
      expect(mainModule.provideLinter().lint(editor)).toEqual([]);
    });
  });

  describe("comment regions", () => {
    const { buildCommentRegions, isInComment } = require("../lib/comment-regions");

    it("detects line and block comments in JavaScript", () => {
      const lines = ["// line comment", "const a = 1; /* block", "still block */ const b = 2;"];
      const regions = buildCommentRegions(lines, ".js");

      expect(isInComment(regions, 0, 4)).toBe(true);
      expect(isInComment(regions, 1, 2)).toBe(false);
      expect(isInComment(regions, 1, 15)).toBe(true);
      expect(isInComment(regions, 2, 5)).toBe(true);
      expect(isInComment(regions, 2, 20)).toBe(false);
    });

    it("detects hash comments in Python", () => {
      const lines = ["x = 1  # TODO later", "y = 2"];
      const regions = buildCommentRegions(lines, ".py");

      expect(isInComment(regions, 0, 10)).toBe(true);
      expect(isInComment(regions, 0, 0)).toBe(false);
      expect(isInComment(regions, 1, 0)).toBe(false);
    });

    it("treats plain text files as comment throughout", () => {
      const regions = buildCommentRegions(["TODO everywhere"], ".txt");
      expect(isInComment(regions, 0, 0)).toBe(true);
    });
  });

  describe("commands", () => {
    it("toggles the linter state", () => {
      expect(lumine.config.get("linter-todo.state")).toBe(true);
      lumine.commands.dispatch(workspaceElement, "linter-todo:toggle-state");
      expect(lumine.config.get("linter-todo.state")).toBe(false);
      lumine.commands.dispatch(workspaceElement, "linter-todo:toggle-state");
      expect(lumine.config.get("linter-todo.state")).toBe(true);
    });
  });
});
