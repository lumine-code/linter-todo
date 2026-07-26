# linter-todo

Report TODO-style keywords as linter messages.

Messages are reported at info level, using the same default keywords as the built-in `language-todo` package.

## Features

- **Editor scan**: reports TODO-style keywords in open editors as info-level linter messages.
- **Project scan**: scans whole projects or tree-view selections in a background task and reports results through the indie linter API.
- **Notebook support**: scans regular source files and Jupyter notebooks (`.ipynb`); in notebook mode each code cell is scanned individually and messages are mapped to the correct cell via [jupyter-view](https://github.com/lumine-code/jupyter-view).
- **Comment detection**: restricts matches to comment regions only, consistent with the built-in `language-todo` package.
- **Configurable keywords**: the list of detected keywords can be adjusted in the package settings.
- **VCS awareness**: project scans respect `core.ignoredNames`, the linter ignore glob and VCS-ignored paths.

## Installation

To install `linter-todo` search for _linter-todo_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/linter-todo`.

## Commands

Commands available in `atom-workspace`:

- `linter-todo:toggle-state`: toggle config of linter state,
- `linter-todo:lint-projects`: scan entire project for TODO keywords,
- `linter-todo:lint-selected`: scan selected tree-view files or folders for TODO keywords.

## Usage

The following keywords are detected by default: `TODO`, `FIXME`, `CHANGED`, `XXX`, `IDEA`, `HACK`, `NOTE`, `REVIEW`, `NB`, `BUG`, `QUESTION`, `COMBAK`, `TEMP`, `DEBUG`, `OPTIMIZE`, `WARNING`.

Both scan modes restrict matches to comment regions only.

**Editor scan** uses hardcoded comment syntax for known file extensions, matching project scan behavior and avoiding tokenizer timing races when a file is first opened. Unknown extensions fall back to the tokenizer: a match is accepted only if its scope descriptor includes a `comment` scope or the file root is `text.plain`.

**Project scan** uses hardcoded comment syntax per file extension, since no tokenizer is available for files not open in the editor. Single-line and block comment markers are defined for all built-in extensions. Plain text files (`.txt`) are accepted in full. Files with no known comment syntax (e.g. `.json`, `.md`) produce no matches. Supported extensions: `.c` `.cpp` `.h` `.hpp` `.cs` `.java` `.js` `.ts` `.jsx` `.tsx` `.vue` `.svelte` `.astro` `.html` `.css` `.scss` `.less` `.xml` `.py` `.ipy` `.rb` `.pl` `.pm` `.sh` `.bash` `.zsh` `.ps1` `.bat` `.cmd` `.go` `.rs` `.swift` `.kt` `.dart` `.scala` `.hs` `.ml` `.el` `.clj` `.ex` `.exs` `.erl` `.yaml` `.yml` `.toml` `.cfg` `.ini` `.conf` `.sql` `.lua` `.r` `.m` `.tex` `.vim` `.coffee` `.cson` `.dat` `.gra` `.grb` `.txt`.

## Services

- **linter.provider** (`1.0.0`): provided to the linter package; exposes the TODO file linter with its name, grammar scopes and `lint` function.
- **linter.registry** (`^1.0.0`): consumed to report project-wide scan results through an indie linter delegate.
- **busy-signal.reporter** (`^1.0.0`): consumed to show a busy message while project scans are running.
- **tree-view** (`^1.0.0`): consumed to resolve the selected files or folders for `linter-todo:lint-selected`.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
