module.exports = function (filePath) {
  const complete = this.async();
  require("../../lib/read-snapshot")(filePath).then(
    (source) => {
      const result = {
        length: source.length,
        lineCount: source.lineCount,
        text: source.slice(0, 30),
      };
      complete(result);
    },
    (error) => complete({ error: error.message }),
  );
};
