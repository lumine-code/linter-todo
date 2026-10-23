const path = require("node:path");
const timers = require("node:timers");

describe("TODO syntax request cancellation", () => {
  let execution;
  beforeEach(() => {
    execution = lumine.grammars.syntaxExecution;
    lumine.grammars.syntaxExecution = "worker";
  });
  afterEach(() => {
    lumine.grammars.syntaxExecution = execution;
  });
  it("releases a worker readiness wait when the linter hub cancels its provider run", async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("language-javascript");
    const main = (await lumine.packages.activatePackage("linter-todo")).mainModule;
    const editor = lumine.workspace.buildTextEditor();
    editor.getBuffer().setPath(path.join(lumine.getConfigDirPath(), "owned-todo.syntax-audit"));
    editor.setText("// TODO: pending syntax\n");
    lumine.grammars.assignGrammar(
      editor.getBuffer(),
      lumine.grammars.grammarForScopeName("source.js"),
    );
    const mode = editor.getBuffer().getLanguageMode();
    expect(mode.asynchronousSyntax).toBeTrue();
    await editor.whenGrammarSettled();
    await mode.refresh();
    let release, entered, timeout;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    spyOn(mode.service, "ensureEnvironment").and.callFake(() => {
      entered();
      return gate;
    });
    const controller = new AbortController();
    const pending = main.provideLinter().lint(editor, { signal: controller.signal });
    try {
      await started;
      controller.abort();
      const result = await Promise.race([
        pending,
        new Promise((resolve) => {
          timeout = timers.setTimeout(() => resolve("still waiting"), 100);
        }),
      ]);
      expect(result).toBeNull();
    } finally {
      timers.clearTimeout(timeout);
      release();
      await pending;
      editor.destroy();
      await lumine.packages.deactivatePackage("linter-todo");
    }
  });
});
