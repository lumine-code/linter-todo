const path = require("node:path");

describe("TODO busy-signal provider ownership", () => {
  let main, indie, leases;

  beforeEach(async () => {
    const pack = await lumine.packages.activatePackage("linter-todo");
    main = pack.mainModule;
    indie = require(path.join(pack.path, "lib/indie"));
    leases = [];
  });

  afterEach(async () => {
    leases.forEach((lease) => lease.dispose());
    await lumine.packages.deactivatePackage("linter-todo");
  });

  function provide(service = { create() {} }) {
    const lease = lumine.packages.serviceHub.provide("busy-signal", "1.0.0", service);
    leases.push(lease);
    return { service, lease };
  }

  it("retains a shared provider until its final hub edge disappears", () => {
    const first = provide();
    const second = provide(first.service);
    first.lease.dispose();
    expect(indie.busySignal).toBe(first.service);
    second.lease.dispose();
    expect(indie.busySignal).toBeNull();
  });

  it("falls back to a still-published provider when the newest edge disappears", () => {
    const first = provide();
    const second = provide();
    second.lease.dispose();
    expect(indie.busySignal).toBe(first.service);
  });

  it("does not clear a replacement activation from a retained old lease", async () => {
    const service = { create() {} };
    const previous = main.consumeBusySignal(service);
    await lumine.packages.deactivatePackage("linter-todo");
    main = (await lumine.packages.activatePackage("linter-todo")).mainModule;
    provide(service);
    previous.dispose();
    expect(indie.busySignal).toBe(service);
  });
});
