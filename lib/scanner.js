/* global emit -- provided by the Task handler runtime */
const path = require("node:path");
const readSnapshot = require("./read-snapshot");
const { collectSource, MAX_MESSAGES, budgetError } = require("./source-scanner");

module.exports = function (
  scanTargets,
  regexSource,
  regexFlags,
  severity = "hint",
  keywordLength = 4096,
) {
  const done = this.async();
  (async () => {
    const messages = [],
      errors = [];
    for (const { projectPath, files } of scanTargets) {
      for (const filePath of files) {
        try {
          const source = await readSnapshot(filePath);
          const found = await collectSource(source, {
            regex: new RegExp(regexSource, regexFlags),
            keywordLength,
            severity: severity ?? "hint",
            filePath,
            extension: path.extname(filePath).toLowerCase(),
            project: true,
          });
          if (messages.length + found.length > MAX_MESSAGES) throw budgetError();
          for (const message of found) messages.push(message);
        } catch (error) {
          if (error.code === "ERR_TODO_RESULTS_LIMIT") throw error;
          if (errors.length < 20)
            errors.push({ projectPath, message: String(error.message || error) });
        }
      }
    }
    emit("linter-todo:project-scan", { messages, errors });
  })()
    .catch((error) =>
      emit("linter-todo:project-scan", {
        messages: [],
        errors: [{ message: String(error.message || error) }],
      }),
    )
    .then(done);
};
