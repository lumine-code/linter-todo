/* global emit -- provided by the Task handler runtime */
const fs = require("fs");
const path = require("path");
const { minimatch } = require("minimatch");
const { KNOWN_EXTENSIONS, buildCommentRegions, isInComment } = require("./comment-regions");

function isGlobIgnored(filePath, ignoreGlob) {
  if (!ignoreGlob) return false;
  const normalizedFilePath = process.platform === "win32" ? filePath.replace(/\\/g, "/") : filePath;
  return minimatch(normalizedFilePath, ignoreGlob, { dot: true });
}

function walkDirectory(dir, fileList, ignoredPatterns, ignoreGlob) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ignoredPatterns.some((p) => minimatch(entry.name, p, { dot: true }))) continue;
    const entryPath = path.join(dir, entry.name);
    if (isGlobIgnored(entryPath, ignoreGlob)) continue;
    if (entry.isDirectory()) {
      walkDirectory(entryPath, fileList, ignoredPatterns, ignoreGlob);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!KNOWN_EXTENSIONS.has(ext)) continue;
      fileList.push(entryPath);
    }
  }
}

function collectFiles(scanPath, fileList, ignoredPatterns, ignoreGlob) {
  if (isGlobIgnored(scanPath, ignoreGlob)) return;

  let stat;
  try {
    stat = fs.statSync(scanPath);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    walkDirectory(scanPath, fileList, ignoredPatterns, ignoreGlob);
  } else if (stat.isFile()) {
    const ext = path.extname(scanPath).toLowerCase();
    if (KNOWN_EXTENSIONS.has(ext)) {
      fileList.push(scanPath);
    }
  }
}

function normalizeScanItem(item) {
  if (typeof item === "string") {
    return { projectPath: item, targetPaths: [item] };
  }

  return {
    projectPath: item.projectPath,
    targetPaths:
      Array.isArray(item.targetPaths) && item.targetPaths.length
        ? item.targetPaths
        : [item.projectPath],
  };
}

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
        severity: "info",
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

module.exports = function (scanItems, ignoredPatterns, ignoreGlob, regexSource, regexFlags) {
  const done = this.async();

  (async () => {
    const messages = [];
    const errors = [];

    for (const scanItem of scanItems) {
      const { projectPath, targetPaths } = normalizeScanItem(scanItem);
      try {
        const files = [];
        for (const targetPath of targetPaths) {
          collectFiles(targetPath, files, ignoredPatterns, ignoreGlob);
        }

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
