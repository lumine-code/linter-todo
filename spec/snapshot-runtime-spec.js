const path = require("node:path");
const { Task } = require("lumine");

describe("TODO project snapshot runtime", () => {
  it("decodes bounded chunks into a public immutable snapshot in a real Task", async () => {
    jasmine.useRealClock();
    let task;
    const result = await new Promise((resolve, reject) => {
      task = Task.once(
        require.resolve("./helpers/snapshot-worker"),
        path.join(__dirname, "fixtures", "sample.js"),
        resolve,
      );
      task.on("task:error", reject);
    }).finally(() => task?.terminate());
    expect(result.error).toBeUndefined();
    expect(result.length).toBeGreaterThan(30);
    expect(result.text).toContain("TODO");
  });

  it("rejects a file that changes while decoding and closes its descriptor", async () => {
    const fs = require("node:fs");
    let reads = 0;
    const file = {
      stat: async () => (reads++ ? { size: 8n, mtimeNs: 2n } : { size: 7n, mtimeNs: 1n }),
      async *createReadStream() {
        yield "// TODO";
      },
      close: jasmine.createSpy("close descriptor").and.resolveTo(),
    };
    spyOn(fs.promises, "open").and.resolveTo(file);
    await expectAsync(require("../lib/read-snapshot")("changed.js")).toBeRejectedWithError(
      /changed while/,
    );
    expect(file.close).toHaveBeenCalledTimes(1);
  });
});
