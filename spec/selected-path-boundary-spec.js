const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Task } = require("lumine");

describe("TODO selected paths inside their actual project", () => {
  let root, temporary, project, priorPaths, indie, delegate, edges;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      if (!jasmine.isSpy(lumine.shell[method])) spyOn(lumine.shell, method).and.resolveTo();
    if (!jasmine.isSpy(lumine.application.openWindow))
      spyOn(lumine.application, "openWindow").and.resolveTo();
    temporary = fs.realpathSync.native(os.tmpdir());
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(temporary, "todo-path-owned-")));
    project = path.join(root, "project");
    fs.mkdirSync(project);
    priorPaths = lumine.project.getPaths();
    lumine.project.setPaths([project]);
    jasmine.attachToDOM(lumine.workspace.getElement());
    const pkg = await lumine.packages.activatePackage("linter-todo");
    indie = require(path.join(pkg.path, "lib/indie"));
    delegate = {
      dispose() {},
      setAllMessages: jasmine.createSpy("actual selected scanner result"),
    };
    edges = [lumine.packages.serviceHub.provide("linter.registry", "1.0.0", () => delegate)];
  });

  afterEach(async () => {
    for (const edge of edges) edge.dispose();
    await lumine.packages.deactivatePackage("linter-todo");
    lumine.project.setPaths(priorPaths);
    await lumine.fileWatchClient.settlePendingTeardown();
    const target = fs.realpathSync.native(root);
    if (path.dirname(target) !== temporary || !path.basename(target).startsWith("todo-path-owned-"))
      throw new Error("Owned TODO path cleanup escaped");
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function scan(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "// TODO: actual selected path\n");
    edges.push(
      lumine.packages.serviceHub.provide("tree-view.selection", "1.0.0", {
        getSelectionSnapshot: () => ({ count: [file].length }),
        selectedPaths: () => [file],
      }),
    );
    const warnings = spyOn(lumine.notifications, "addWarning");
    const task = spyOn(Task, "once").and.callThrough();
    const tree = document.createElement("div");
    tree.className = "tree-view";
    lumine.workspace.getElement().appendChild(tree);
    lumine.commands.dispatch(tree, "linter-todo:lint-selected");
    await flushMicrotasks();
    return { warnings, task };
  }

  for (const directory of ["..notes", "ordinary"])
    it(`scans an actual selected file in the ${directory} child directory`, async () => {
      const file = path.join(project, directory, "selected.js");
      const { warnings, task } = await scan(file);
      expect(warnings).not.toHaveBeenCalled();
      expect(task.calls.count()).toBe(1);
      // On the immutable source, the legal ..notes child is rejected before a
      // worker starts; report that exact path failure without a timeout.
      if (!task.calls.count()) return;
      await conditionPromise(() => delegate.setAllMessages.calls.count() > 0);
      await conditionPromise(() => !indie.scanning);
      const [messages] = delegate.setAllMessages.calls.mostRecent().args;
      expect(messages.length).toBe(1);
      expect(messages[0].location.file).toBe(file);
      expect(messages[0].excerpt).toBe("TODO: actual selected path");
    });

  it("rejects an actual selected file outside the project", async () => {
    const { warnings, task } = await scan(path.join(root, "outside.js"));
    expect(warnings).toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();
    expect(delegate.setAllMessages).not.toHaveBeenCalled();
  });
});
