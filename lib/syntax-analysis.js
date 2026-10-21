const { buildCommentRegions, getKnownExtension, isInComment } = require("./comment-regions");
function isCommentPosition(editor, commentRegions, position) {
  const row = Array.isArray(position) ? position[0] : position.row;
  const column = Array.isArray(position) ? position[1] : position.column;

  if (commentRegions !== undefined) {
    return isInComment(commentRegions, row, column);
  }

  const scopes = editor.scopeDescriptorForBufferPosition(position).getScopesArray();
  return scopes.some((s) => s.startsWith("comment") || s === "text.plain");
}

function collect(editor, regex, severity) {
  const filePath = editor.getPath();
  if (!filePath) return [];

  const messages = [];
  const knownExt = getKnownExtension(filePath);
  let commentRegions;

  editor.scanInBufferRange(
    regex,
    [
      [0, 0],
      [Infinity, Infinity],
    ],
    ({ match, range }) => {
      // Most buffers contain no keywords. Build the full comment map only if
      // there is a match to classify, then reuse it for the remaining matches.
      if (knownExt && commentRegions === undefined) {
        commentRegions = buildCommentRegions(editor.getBuffer().getLines(), knownExt);
      }
      if (!isCommentPosition(editor, commentRegions, range.start)) return;

      const keyword = match[1];
      const lineText = editor.lineTextForBufferRow(range.start.row);
      const afterKeyword = lineText.substring(range.end.column);
      const textInAfter = afterKeyword.replace(/^:\s*/, "").trimStart();
      const textStartColumn = range.end.column + (afterKeyword.length - textInAfter.length);
      let text = textInAfter.trimEnd();

      let nextRow = range.start.row + 1;
      while (text) {
        const nextLine = editor.lineTextForBufferRow(nextRow);
        if (nextLine == null) break;
        const charAtCol = nextLine[textStartColumn];
        if (!charAtCol || charAtCol === " " || charAtCol === "\t") break;
        if (!isCommentPosition(editor, commentRegions, [nextRow, textStartColumn])) break;
        text += " " + nextLine.substring(textStartColumn).trim();
        nextRow++;
      }

      const code = lineText
        .substring(0, range.start.column)
        .replace(/[\s#/*!<>-]+$/, "")
        .trim();

      let excerpt;
      if (text && code) excerpt = `${keyword}: ${text}, \`${code}\``;
      else if (text) excerpt = `${keyword}: ${text}`;
      else if (code) excerpt = `${keyword}: \`${code}\``;
      else excerpt = keyword;

      messages.push({
        severity: severity,
        excerpt,
        location: {
          file: filePath,
          position: [
            [range.start.row, range.start.column],
            [range.end.row, range.end.column],
          ],
        },
      });
    },
  );

  return messages;
}
exports.collect = collect;
exports.lint = async function (context, { source, flags, severity }, { signal, emit }) {
  const messages = collect(context, new RegExp(source, flags), severity);
  for (let start = 0; start < messages.length; start += 256) {
    signal.throwIfAborted();
    await emit(messages.slice(start, start + 256));
  }
  return { count: messages.length };
};
