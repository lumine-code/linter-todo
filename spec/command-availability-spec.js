describe("linter-todo scan availability", () => {
  it("reads roots, service and passive tree selection without starting a scan", async () => {
    await lumine.packages.activatePackage("linter-todo");
    const indie = require("../lib/indie");
    jasmine.attachToDOM(lumine.workspace.getElement());
    const target = document.createElement("div");
    target.className = "tree-view";
    lumine.workspace.getElement().appendChild(target);
    const available = (action) => lumine.commands.canDispatch(target, "linter-todo:" + action);
    const roots = spyOn(lumine.project, "getPaths").and.returnValue([]);
    indie.indieDelegate = null;
    expect(available("lint-projects")).toBe(false);
    indie.indieDelegate = {};
    roots.and.returnValue(["/project"]);
    expect(available("lint-projects")).toBe(true);
    indie.treeView = {
      getSelectionSnapshot: () => ({ count: 0 }),
      selectedPaths: jasmine.createSpy("initialize tree"),
    };
    expect(available("lint-selected")).toBe(false);
    indie.treeView.getSelectionSnapshot = () => ({ count: 1 });
    expect(available("lint-selected")).toBe(true);
    expect(indie.treeView.selectedPaths).not.toHaveBeenCalled();
    indie.scanning = true;
    expect(available("lint-projects")).toBe(false);
    indie.scanning = false;
    indie.indieDelegate = null;
    indie.indieDelegate = null;
    target.remove();
    await lumine.packages.deactivatePackage("linter-todo");
  });
});
