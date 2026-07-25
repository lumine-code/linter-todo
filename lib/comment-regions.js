const path = require("path");

// Arrays of single-line comment markers per extension
const SINGLE_LINE = {
  ".js": ["//"],
  ".ts": ["//"],
  ".jsx": ["//"],
  ".tsx": ["//"],
  ".java": ["//"],
  ".c": ["//"],
  ".cpp": ["//"],
  ".h": ["//"],
  ".hpp": ["//"],
  ".cs": ["//"],
  ".go": ["//"],
  ".rs": ["//"],
  ".php": ["//"],
  ".swift": ["//"],
  ".kt": ["//"],
  ".scala": ["//"],
  ".dart": ["//"],
  ".vue": ["//"],
  ".svelte": ["//"],
  ".astro": ["//"],
  ".py": ["#"],
  ".ipy": ["#"],
  ".rb": ["#"],
  ".sh": ["#"],
  ".bash": ["#"],
  ".zsh": ["#"],
  ".ps1": ["#"],
  ".r": ["#"],
  ".yaml": ["#"],
  ".yml": ["#"],
  ".toml": ["#"],
  ".cfg": ["#"],
  ".ini": ["#"],
  ".conf": ["#"],
  ".pl": ["#"],
  ".pm": ["#"],
  ".coffee": ["#"],
  ".cson": ["#"],
  ".ex": ["#"],
  ".exs": ["#"],
  ".lua": ["--"],
  ".sql": ["--"],
  ".hs": ["--"],
  ".erl": ["%"],
  ".tex": ["%"],
  ".m": ["%"],
  ".el": [";"],
  ".clj": [";"],
  ".vim": ['"'],
  ".bat": ["::"],
  ".cmd": ["::"],
  ".dat": ["//", "$", "!"],
  ".gra": ["//", "$", "!"],
  ".grb": ["//", "$", "!"],
};

// Block comment markers per extension [open, close]
const BLOCK = {
  ".js": ["/*", "*/"],
  ".ts": ["/*", "*/"],
  ".jsx": ["/*", "*/"],
  ".tsx": ["/*", "*/"],
  ".java": ["/*", "*/"],
  ".c": ["/*", "*/"],
  ".cpp": ["/*", "*/"],
  ".h": ["/*", "*/"],
  ".hpp": ["/*", "*/"],
  ".cs": ["/*", "*/"],
  ".go": ["/*", "*/"],
  ".rs": ["/*", "*/"],
  ".php": ["/*", "*/"],
  ".swift": ["/*", "*/"],
  ".kt": ["/*", "*/"],
  ".scala": ["/*", "*/"],
  ".dart": ["/*", "*/"],
  ".css": ["/*", "*/"],
  ".scss": ["/*", "*/"],
  ".less": ["/*", "*/"],
  ".vue": ["/*", "*/"],
  ".svelte": ["/*", "*/"],
  ".astro": ["/*", "*/"],
  ".html": ["<!--", "-->"],
  ".xml": ["<!--", "-->"],
  ".hs": ["{-", "-}"],
  ".ml": ["(*", "*)"],
};

// Extensions where all content is plain text (scope text.plain)
const PLAIN_TEXT = new Set([".txt"]);

const KNOWN_EXTENSIONS = new Set([
  ...Object.keys(SINGLE_LINE),
  ...Object.keys(BLOCK),
  ...PLAIN_TEXT,
]);

function getKnownExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? ext : null;
}

function buildCommentRegions(lines, ext) {
  if (PLAIN_TEXT.has(ext)) return null;

  const slMarkers = SINGLE_LINE[ext] || [];
  const bl = BLOCK[ext];
  if (!slMarkers.length && !bl) return [];

  const regions = lines.map(() => []);
  let inBlock = false;

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    let col = 0;

    if (inBlock) {
      const closeIdx = line.indexOf(bl[1]);
      if (closeIdx === -1) {
        regions[row].push([0, Infinity]);
        continue;
      }
      regions[row].push([0, closeIdx + bl[1].length]);
      inBlock = false;
      col = closeIdx + bl[1].length;
    }

    while (col < line.length) {
      if (bl && line.startsWith(bl[0], col)) {
        const closeIdx = line.indexOf(bl[1], col + bl[0].length);
        if (closeIdx === -1) {
          regions[row].push([col, Infinity]);
          inBlock = true;
          break;
        }
        regions[row].push([col, closeIdx + bl[1].length]);
        col = closeIdx + bl[1].length;
      } else {
        const slMarker = slMarkers.find((m) => line.startsWith(m, col));
        if (slMarker) {
          regions[row].push([col, Infinity]);
          break;
        }
        col++;
      }
    }
  }

  return regions;
}

function isInComment(regions, row, col) {
  if (regions === null) return true;
  if (!regions[row]) return false;
  return regions[row].some(([start, end]) => col >= start && col < end);
}

module.exports = {
  KNOWN_EXTENSIONS,
  buildCommentRegions,
  getKnownExtension,
  isInComment,
};
