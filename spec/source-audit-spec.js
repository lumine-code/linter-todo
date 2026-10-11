const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const timers = require("node:timers");

describe("TODO scan failure and keyword boundaries", () => {
  let main, indie, directory, file, leases, delegate;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "todo-source-owned-")));
    file = path.join(directory, "source.js");
    fs.writeFileSync(file, "// TODO: owned meaningful message\n");
    lumine.project.setPaths([directory]);
    const pack = await lumine.packages.activatePackage("linter-todo");
    main = pack.mainModule;
    indie = require(path.join(pack.path, "lib", "indie"));
    leases = [];
    delegate = { dispose() {}, setAllMessages: jasmine.createSpy("owned TODO results") };
    leases.push(lumine.packages.serviceHub.provide("linter.registry", "1.0.0", () => delegate));
  });
  afterEach(async () => {
    leases.forEach((lease) => lease.dispose());
    await lumine.packages.deactivatePackage("linter-todo");
    lumine.config.unset("linter-todo.keywords");
    lumine.project.setPaths([]);
    await lumine.fileWatchClient.settlePendingTeardown();
    const relative = path.relative(fs.realpathSync(os.tmpdir()), directory);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unsafe owned TODO cleanup");
    fs.rmSync(directory, { recursive: true, force: true });
  });
  async function resultWithinDeadline() {
    if (delegate.setAllMessages.calls.count()) return true;
    return new Promise((resolve) => {
      const timeout = timers.setTimeout(() => resolve(false), 2500);
      const update = delegate.setAllMessages;
      update.and.callFake(() => {
        timers.clearTimeout(timeout);
        resolve(true);
      });
    });
  }
  it("ignores an empty keyword while the production scanner still finds a configured TODO", async () => {
    lumine.config.set("linter-todo.keywords", ["", "TODO"]);
    await indie.runScan([{ projectPath: directory, targetPaths: [file] }]);
    expect(await resultWithinDeadline()).toBe(true);
    const [messages] = delegate.setAllMessages.calls.mostRecent().args;
    expect(messages.length).toBe(1);
    expect(messages[0].excerpt).toBe("TODO: owned meaningful message");
  });
  it("releases scan and busy ownership after an actual crawl rejection and allows retry", async () => {
    const disposed = jasmine.createSpy("owned busy disposal");
    leases.push(
      lumine.packages.serviceHub.provide("busy-signal", "1.0.0", {
        create: () => ({ add() {}, dispose: disposed }),
      }),
    );
    const crawl = lumine.project.crawl.bind(lumine.project);
    let calls = 0;
    spyOn(lumine.project, "crawl").and.callFake((...args) => {
      if (++calls === 1) return Promise.reject(new Error("Owned crawl failure"));
      return crawl(...args);
    });
    await expectAsync(indie.runScan()).toBeRejectedWithError("Owned crawl failure");
    expect(indie.scanning).toBe(false);
    expect(indie.busyProvider).toBeNull();
    expect(disposed).toHaveBeenCalled();
    await indie.runScan();
    expect(await resultWithinDeadline()).toBe(true);
    expect(indie.scanning).toBe(false);
  });

  it("disables matching when only an empty keyword is configured", async () => {
    lumine.config.set("linter-todo.keywords", [""]);
    const editor = await lumine.workspace.open(file);
    try {
      expect(main.provideLinter().lint(editor)).toEqual([]);
    } finally {
      editor.destroy();
    }
  });

  it("settles an obsolete crawl rejection after the actual package retires", async () => {
    let reject;
    spyOn(lumine.project, "crawl").and.returnValue(
      new Promise((resolve, failure) => (reject = failure)),
    );
    const scanning = indie.runScan();
    await lumine.packages.deactivatePackage("linter-todo");
    reject(new Error("Owned obsolete crawl failure"));
    await expectAsync(scanning).toBeResolved();
    expect(indie.scanning).toBe(false);
  });
});
