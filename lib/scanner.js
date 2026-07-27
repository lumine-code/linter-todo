/* global emit -- provided by the Task handler runtime */
const fs = require("fs");
const path = require("path");
const { buildCommentRegions, isInComment } = require("./comment-regions");

// There is no `atom.config` in a Task child process, so the severity arrives as
// an argument. `Task.once` spawns a fresh process per scan, which makes module
// state scan-scoped — no need to thread it down through every scan function.
let severity = "hint";

function scanFile(filePath, regexSource, regexFlags) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const ext = path.extname(filePath).toLowerCase();
  const lines = text.split("\n");
  const commentRegions = buildCommentRegions(lines, ext);
  const regex = new RegExp(regexSource, regexFlags);
  const messages = [];

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    regex.lastIndex = 0;
    let match;

    while ((match = regex.exec(line)) !== null) {
      const col = match.index;
      if (!isInComment(commentRegions, row, col)) continue;

      const keyword = match[1];
      const afterKeyword = line.substring(col + keyword.length);
      const textInAfter = afterKeyword.replace(/^:\s*/, "").trimStart();
      const textStartColumn = col + keyword.length + (afterKeyword.length - textInAfter.length);
      let text = textInAfter.trimEnd();

      let nextRow = row + 1;
      while (text) {
        const nextLine = lines[nextRow];
        if (nextLine == null) break;
        const charAtCol = nextLine[textStartColumn];
        if (!charAtCol || charAtCol === " " || charAtCol === "\t") break;
        if (!isInComment(commentRegions, nextRow, textStartColumn)) break;
        text += " " + nextLine.substring(textStartColumn).trim();
        nextRow++;
      }

      const code = line
        .substring(0, col)
        .replace(/[\s#/*!<>\-;:'"$]+$/, "")
        .trim();

      let excerpt;
      if (text && code) excerpt = `${keyword}: ${text}, \`${code}\``;
      else if (text) excerpt = `${keyword}: ${text}`;
      else if (code) excerpt = `${keyword}: \`${code}\``;
      else excerpt = keyword;

      messages.push({
        severity,
        excerpt,
        location: {
          file: filePath,
          position: [
            [row, col],
            [row, col + keyword.length],
          ],
        },
      });
    }
  }

  return messages;
}

// `scanTargets` is `[{ projectPath, files }]`. The file lists are gathered by
// the caller through `atom.project.crawl()`, so this handler only reads and
// scans: it never walks the filesystem itself.
//
// `messageSeverity` falls back twice: the parameter default covers a caller
// that omits it, the `??` one that passes it unset — the Task channel is JSON,
// so an `undefined` argument arrives as `null` and slips past the default.
// Either way an invalid severity makes the hub validator drop the whole batch.
module.exports = function (scanTargets, regexSource, regexFlags, messageSeverity = "hint") {
  const done = this.async();
  severity = messageSeverity ?? "hint";

  (async () => {
    const messages = [];
    const errors = [];

    for (const { projectPath, files } of scanTargets) {
      try {
        for (const filePath of files) {
          messages.push(...scanFile(filePath, regexSource, regexFlags));
        }
      } catch (error) {
        errors.push({
          projectPath,
          message: String(error.message || error),
        });
      }
    }

    emit("linter-todo:project-scan", { messages, errors });
  })()
    .catch((error) => {
      emit("linter-todo:project-scan", {
        messages: [],
        errors: [
          {
            message: String(error.message || error),
          },
        ],
      });
    })
    .then(done);
};
