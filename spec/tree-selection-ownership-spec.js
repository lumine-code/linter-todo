const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Task } = require("lumine");

describe("TODO tree selection service ownership", () => {
  let directory, temporaryRoot, firstPath, secondPath, edges, indie, main, delegate;

  beforeEach(async () => {
    jasmine.useRealClock();
    temporaryRoot = fs.realpathSync.native(os.tmpdir());
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(temporaryRoot, "todo-edge-owned-")),
    );
    firstPath = path.join(directory, "first.js");
    secondPath = path.join(directory, "second.js");
    fs.writeFileSync(firstPath, "// TODO: first selected file\n");
    fs.writeFileSync(secondPath, "// TODO: second selected file\n");
    lumine.project.setPaths([directory]);
    jasmine.attachToDOM(lumine.workspace.getElement());
    edges = [];
    main = (await lumine.packages.activatePackage("linter-todo")).mainModule;
    indie = require("../lib/indie");
    delegate = {
      dispose: jasmine.createSpy("dispose delegate"),
      setAllMessages: jasmine.createSpy("publish selected TODO messages"),
    };
    edges.push(lumine.packages.serviceHub.provide("linter.registry", "1.0.0", () => delegate));
  });

  afterEach(async () => {
    for (const edge of edges) edge.dispose();
    await lumine.packages.deactivatePackage("linter-todo");
    lumine.project.setPaths([]);
    const relative = path.relative(temporaryRoot, directory);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error("Temporary selection fixture escaped its root");
    }
    await fs.promises.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  function provider(filePath) {
    return {
      selectedPaths: jasmine.createSpy("selected paths").and.returnValue([filePath]),
      destroy: jasmine.createSpy("borrowed provider destroy"),
      dispose: jasmine.createSpy("borrowed provider dispose"),
    };
  }

  function provide(selection) {
    const edge = lumine.packages.serviceHub.provide("tree-view.selection", "1.0.0", selection);
    edges.push(edge);
    return edge;
  }

  async function expectSelectedWorker(filePath) {
    const once = spyOn(Task, "once").and.callThrough();
    await lumine.commands.dispatch(lumine.workspace.getElement(), "linter-todo:lint-selected");
    await conditionPromise(() => delegate.setAllMessages.calls.count() > 0);
    await conditionPromise(() => !indie.scanning);
    expect(once.calls.count()).toBe(1);
    expect(once.calls.mostRecent().args[0]).toBe(path.join(__dirname, "../lib/scanner.js"));
    const [messages, options] = delegate.setAllMessages.calls.mostRecent().args;
    expect(messages.length).toBe(1);
    expect(messages[0].location.file).toBe(filePath);
    expect(messages[0].excerpt).toContain("selected file");
    expect(options.showProjectView).toBe(true);
  }

  it("keeps the newer distinct provider and scans its selected file after an older edge is withdrawn", async () => {
    const first = provider(firstPath);
    const second = provider(secondPath);
    const firstEdge = provide(first);
    provide(second);
    expect(indie.treeView).toBe(second);
    firstEdge.dispose();
    expect(indie.treeView).toBe(second);
    // Fail at the ownership boundary on the original code, without waiting for
    // a worker that it never starts. The repaired path runs the actual Task.
    if (indie.treeView !== second) return;
    await expectSelectedWorker(secondPath);
    expect(first.selectedPaths).not.toHaveBeenCalled();
    expect(second.selectedPaths.calls.count()).toBe(1);
  });

  it("shares an identical payload until its final registration is withdrawn", async () => {
    const selection = provider(firstPath);
    const firstEdge = provide(selection);
    const secondEdge = provide(selection);
    firstEdge.dispose();
    expect(indie.treeView).toBe(selection);
    if (indie.treeView !== selection) return;
    await expectSelectedWorker(firstPath);
    expect(selection.selectedPaths.calls.count()).toBe(1);
    secondEdge.dispose();
    expect(indie.treeView).toBeNull();
    expect(selection.destroy).not.toHaveBeenCalled();
    expect(selection.dispose).not.toHaveBeenCalled();
  });

  it("falls back to the preceding live provider and scans its own selection", async () => {
    const first = provider(firstPath);
    const second = provider(secondPath);
    provide(first);
    const secondEdge = provide(second);
    secondEdge.dispose();
    expect(indie.treeView).toBe(first);
    if (indie.treeView !== first) return;
    await expectSelectedWorker(firstPath);
    expect(first.selectedPaths.calls.count()).toBe(1);
    expect(second.selectedPaths).not.toHaveBeenCalled();
  });

  it("orders interleaved shared payloads by the last still-live registration", () => {
    const first = provider(firstPath);
    const second = provider(secondPath);
    const oldest = provide(first);
    const middle = provide(second);
    const newest = provide(first);
    expect(indie.treeView).toBe(first);
    newest.dispose();
    expect(indie.treeView).toBe(second);
    oldest.dispose();
    expect(indie.treeView).toBe(second);
    middle.dispose();
    expect(indie.treeView).toBeNull();
  });

  it("keeps a replacement package owner when a captured old service lease is disposed", async () => {
    const oldSelection = provider(firstPath);
    const oldLease = main.consumeTreeViewSelection(oldSelection);
    const oldIndie = indie;
    await lumine.packages.deactivatePackage("linter-todo");
    expect(oldIndie.treeView).toBeNull();
    main = (await lumine.packages.activatePackage("linter-todo")).mainModule;
    indie = require("../lib/indie");
    const current = provider(secondPath);
    provide(current);
    oldLease.dispose();
    expect(indie.treeView).toBe(current);
    expect(oldSelection.destroy).not.toHaveBeenCalled();
    expect(oldSelection.dispose).not.toHaveBeenCalled();
    await lumine.packages.deactivatePackage("linter-todo");
    expect(indie.treeView).toBeNull();
    expect(current.destroy).not.toHaveBeenCalled();
    expect(current.dispose).not.toHaveBeenCalled();
  });

  it("executes a normal selected scan through the actual worker", async () => {
    const selection = provider(firstPath);
    provide(selection);
    await expectSelectedWorker(firstPath);
    expect(selection.selectedPaths.calls.count()).toBe(1);
  });
});
