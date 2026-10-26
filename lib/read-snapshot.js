const fs = require("node:fs");
const { TextBuffer } = require("lumine");

module.exports = async function readSnapshot(filePath) {
  const file = await fs.promises.open(filePath, "r");
  try {
    const before = await file.stat({ bigint: true });
    let source = TextBuffer.createTextSnapshot("");
    for await (const chunk of file.createReadStream({
      encoding: "utf8",
      highWaterMark: 65536,
      autoClose: false,
    }))
      source = source.replace(source.length, source.length, chunk);
    const after = await file.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      throw new Error("The TODO source changed while it was being read; run the scan again.");
    const named = await fs.promises.stat(filePath, { bigint: true });
    if (
      before.dev !== named.dev ||
      before.ino !== named.ino ||
      before.size !== named.size ||
      before.mtimeNs !== named.mtimeNs
    )
      throw new Error("The TODO source was replaced while it was being read; run the scan again.");
    return source;
  } finally {
    await file.close();
  }
};
