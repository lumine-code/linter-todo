const { commentRules } = require("./comment-regions");
const WINDOW = 32768;
const MAX_MESSAGES = 10000;
const MAX_EXCERPT = 1024;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function budgetError() {
  return Object.assign(new Error("TODO analysis exceeds the 10000 diagnostic result budget."), {
    code: "ERR_TODO_RESULTS_LIMIT",
  });
}

function preview(text, maximum = MAX_EXCERPT) {
  if (text.length <= maximum) return Array.from(text).join("");
  let end = maximum;
  if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
  return Array.from(text.slice(0, end) + "…").join("");
}

class CommentCursor {
  constructor(source, ext) {
    this.source = source;
    this.rules = commentRules(ext);
    this.offset = 0;
    this.kind = null;
    this.closeAt = 0;
    const starts = [...(this.rules.block ? [this.rules.block[0]] : []), ...this.rules.single];
    this.starts = starts.length ? new RegExp(starts.map(escape).join("|"), "g") : null;
  }
  clone() {
    return Object.assign(Object.create(CommentCursor.prototype), this);
  }

  *at(target) {
    if (this.rules.plain) return true;
    if (!this.starts) return false;
    if (this.closeAt) {
      if (target < this.closeAt) return true;
      this.offset = this.closeAt;
      this.closeAt = 0;
      this.kind = null;
    }
    while (this.offset <= target) {
      yield;
      const delimiter =
        this.kind === "block" ? this.rules.block[1] : this.kind === "line" ? "\n" : null;
      const expression = delimiter ? new RegExp(escape(delimiter), "g") : this.starts;
      const end = Math.min(this.source.length, target + 4, this.offset + WINDOW);
      const text = this.source.slice(this.offset, end);
      expression.lastIndex = 0;
      const found = expression.exec(text);
      if (!found || this.offset + found.index > target) {
        this.offset = end >= target + 1 ? target + 1 : Math.max(this.offset + 1, end - 3);
        continue;
      }
      const start = this.offset + found.index;
      const after = start + found[0].length;
      if (this.kind === "block") {
        if (after > target) {
          this.closeAt = after;
          this.offset = target + 1;
          return true;
        }
        this.kind = null;
      } else if (this.kind === "line") this.kind = null;
      else this.kind = this.rules.block && found[0] === this.rules.block[0] ? "block" : "line";
      this.offset = after;
    }
    return this.kind !== null;
  }
}

function lineEnd(source, row) {
  let end = row + 1 < source.lineCount ? source.lineStart(row + 1) - 1 : source.length;
  if (end > source.lineStart(row) && source.charCodeAt(end - 1) === 13) end--;
  return end;
}

function* keywords(source, regex, width) {
  let resume = 0;
  for (let offset = 0; offset < source.length; offset += WINDOW) {
    yield;
    const boundary = Math.min(source.length, offset + WINDOW);
    const start = Math.max(0, offset - 1);
    const text = source.slice(start, Math.min(source.length, boundary + width + 1));
    regex.lastIndex = Math.max(0, resume - start);
    let match;
    while ((match = regex.exec(text))) {
      const found = start + match.index;
      if (found >= boundary) break;
      if (!match[0].length) {
        regex.lastIndex++;
        continue;
      }
      resume = found + match[0].length;
      yield { start: found, end: resume, keyword: match[1] };
    }
  }
}

function* collectSteps(
  source,
  { regex, keywordLength, severity, filePath, extension, isComment, project = false },
  messages,
) {
  const comments = extension ? new CommentCursor(source, extension) : null;
  for (const found of keywords(source, regex, keywordLength)) {
    yield;
    if (!found) continue;
    const start = source.positionAt(found.start),
      end = source.positionAt(found.end);
    if (!(comments ? yield* comments.at(found.start) : isComment(start))) continue;
    if (messages.length === MAX_MESSAGES) throw budgetError();
    const endOfLine = lineEnd(source, start.row);
    const tailEnd = Math.min(endOfLine, found.end + 513);
    const tail = source.slice(found.end, tailEnd);
    const after = tail.replace(/^:\s*/, "").trimStart();
    const column = end.column + tail.length - after.length;
    let text = after.trimEnd();
    if (tailEnd < endOfLine) text += "…";
    const lookahead = comments?.clone();
    if (text && tailEnd === endOfLine) {
      for (let row = start.row + 1; row < source.lineCount; row++) {
        yield;
        if (row > start.row + 8 || text.length >= 512) {
          text += "…";
          break;
        }
        const at = source.lineStart(row) + column,
          last = lineEnd(source, row);
        if (at >= last) break;
        const char = source.charCodeAt(at);
        if (char === 32 || char === 9) break;
        if (!(lookahead ? yield* lookahead.at(at) : isComment({ row, column }))) break;
        const nextEnd = Math.min(last, at + 513);
        text += " " + source.slice(at, nextEnd).trim();
        if (nextEnd < last) {
          text += "…";
          break;
        }
      }
    }
    const rowStart = source.lineStart(start.row),
      codeStart = Math.max(rowStart, found.start - 256);
    const pattern = project ? /[\s#/*!<>\-;:'"$]+$/ : /[\s#/*!<>-]+$/;
    const code =
      (codeStart > rowStart ? "…" : "") +
      source.slice(codeStart, found.start).replace(pattern, "").trim();
    const excerpt =
      text && code
        ? `${found.keyword}: ${text}, \`${code}\``
        : text
          ? `${found.keyword}: ${text}`
          : code
            ? `${found.keyword}: \`${code}\``
            : found.keyword;
    messages.push({
      severity,
      excerpt: preview(excerpt),
      location: {
        file: filePath,
        position: [
          [start.row, start.column],
          [end.row, end.column],
        ],
      },
    });
  }
}

function collectSource(source, options) {
  const keywordLength = options.keywordLength ?? 4096;
  if (!Number.isSafeInteger(keywordLength) || keywordLength < 1 || keywordLength > 4096)
    throw new RangeError("TODO keyword length must fit the 4096-unit token budget.");
  const messages = [];
  const iterator = collectSteps(
    source,
    { ...options, keywordLength, regex: new RegExp(options.regex.source, options.regex.flags) },
    messages,
  );
  const step = () => {
    options.signal?.throwIfAborted();
    if (options.isCurrent && !options.isCurrent())
      throw Object.assign(new Error("TODO scan superseded"), { name: "AbortError" });
    return iterator.next();
  };
  if (source.length <= WINDOW) {
    while (!step().done) {
      /* bounded synchronous compatibility */
    }
    return messages;
  }
  return (async () => {
    await new Promise((resolve) => setImmediate(resolve));
    let deadline = performance.now() + 4;
    while (!step().done)
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setImmediate(resolve));
        deadline = performance.now() + 4;
      }
    return messages;
  })();
}

module.exports = { collectSource, MAX_MESSAGES, budgetError };
