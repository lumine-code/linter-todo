const { getKnownExtension } = require("./comment-regions");
const { collectSource } = require("./source-scanner");

function collect(editor, regex, severity, { signal, keywordLength = 4096, isCurrent } = {}) {
  const filePath = editor.getPath();
  if (!filePath) return [];
  const buffer = editor.getBuffer(),
    revision = buffer.getTextRevision();
  return collectSource(buffer.getTextSnapshot(), {
    regex,
    severity,
    filePath,
    signal,
    keywordLength,
    extension: getKnownExtension(filePath),
    isCurrent: () =>
      !editor.isDestroyed?.() &&
      buffer.getTextRevision() === revision &&
      (!isCurrent || isCurrent()),
    isComment: (position) =>
      editor
        .scopeDescriptorForBufferPosition(position)
        .getScopesArray()
        .some((scope) => scope.startsWith("comment") || scope === "text.plain"),
  });
}
exports.collect = collect;
exports.lint = async function (
  context,
  { source, flags, severity, keywordLength },
  { signal, emit },
) {
  const messages = await collect(context, new RegExp(source, flags), severity, {
    signal,
    keywordLength,
  });
  for (let start = 0; start < messages.length; start += 256) {
    signal.throwIfAborted();
    await emit(messages.slice(start, start + 256));
  }
  return { count: messages.length };
};
