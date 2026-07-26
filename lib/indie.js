const { Task } = require("atom");
const fs = require("fs");
const path = require("path");

class ProjectLinter {
  constructor() {
    this.indieDelegate = null;
    this.busySignal = null;
    this.busyProvider = null;
    this.scanning = false;
    this.main = null;
    this.scanId = 0;
    this.task = null;
    this.treeView = null;
  }

  register(delegate, main) {
    this.indieDelegate = delegate;
    this.main = main;
  }

  setBusySignal(busySignal) {
    this.busySignal = busySignal;
  }

  setTreeView(treeView) {
    this.treeView = treeView;
  }

  startBusyMessage() {
    this.disposeBusyMessage();
    if (this.busySignal && typeof this.busySignal.create === "function") {
      this.busyProvider = this.busySignal.create();
      this.busyProvider.add("Scanning project for TODOs");
    }
  }

  disposeBusyMessage() {
    this.busyProvider?.dispose();
    this.busyProvider = null;
  }

  async isVcsIgnored(filePath) {
    if (!filePath) return true;
    try {
      const repository = await atom.project.repositoryForPath(filePath);
      return Boolean(repository && repository.isPathIgnored(filePath));
    } catch (error) {
      console.error("[linter-todo] VCS ignore check failed:", error);
      return false;
    }
  }

  async filterIgnoredMessages(messages) {
    if (!atom.config.get("core.excludeVcsIgnoredPaths")) {
      return messages;
    }

    const ignored = new Map();
    const filtered = [];

    for (const message of messages) {
      const filePath = message.location && message.location.file;
      if (!ignored.has(filePath)) {
        ignored.set(filePath, await this.isVcsIgnored(filePath));
      }
      if (!ignored.get(filePath)) {
        filtered.push(message);
      }
    }

    return filtered;
  }

  getProjectPathForPath(filePath) {
    return atom.project.getPaths().find((projectPath) => {
      const relativePath = path.relative(projectPath, filePath);
      return (
        relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
      );
    });
  }

  getSelectedScanItems() {
    if (!this.treeView || typeof this.treeView.selectedPaths !== "function") return [];

    const selectedPaths = this.treeView
      .selectedPaths()
      .filter(Boolean)
      .filter((selectedPath, index, paths) => paths.indexOf(selectedPath) === index)
      .filter((selectedPath) => {
        try {
          return fs.existsSync(selectedPath);
        } catch {
          return false;
        }
      });

    const scanItemsByProject = new Map();
    for (const selectedPath of selectedPaths) {
      const projectPath = this.getProjectPathForPath(selectedPath);
      if (!projectPath) continue;

      if (!scanItemsByProject.has(projectPath)) {
        scanItemsByProject.set(projectPath, {
          projectPath,
          targetPaths: [],
        });
      }
      scanItemsByProject.get(projectPath).targetPaths.push(selectedPath);
    }

    return Array.from(scanItemsByProject.values());
  }

  runSelectedScan() {
    const scanItems = this.getSelectedScanItems();
    if (!scanItems.length) {
      atom.notifications.addWarning("TODO selected scan skipped", {
        detail: "Select one or more files or folders in the tree view first.",
        dismissable: true,
      });
      return;
    }

    this.runScan(scanItems);
  }

  runScan(scanItems = null) {
    if (!this.indieDelegate || !this.main) return;
    if (this.scanning) return;
    if (!this.main.regex) return;

    this.scanning = true;
    this.startBusyMessage();

    const resolvedScanItems = scanItems || atom.project.getPaths();
    if (!resolvedScanItems.length) {
      this.disposeBusyMessage();
      this.scanning = false;
      return;
    }

    const ignoredPatterns = atom.config.get("core.ignoredNames") || [];
    const ignoreGlob = atom.config.get("linter.ignoreGlob");
    const taskPath = path.join(__dirname, "scanner.js");
    const scanId = ++this.scanId;
    let receivedResults = false;
    const task = Task.once(
      taskPath,
      resolvedScanItems,
      ignoredPatterns,
      ignoreGlob,
      this.main.regex.source,
      this.main.regex.flags,
      () => {
        if (scanId !== this.scanId || !this.indieDelegate || receivedResults) return;

        this.indieDelegate.setAllMessages([], {
          showProjectView: true,
        });
        atom.notifications.addWarning("TODO project scan failed", {
          detail: "The scan task finished without returning results.",
          dismissable: true,
        });
        this.scanning = false;
        this.task = null;
        this.disposeBusyMessage();
      },
    );
    this.task = task;

    task.on("linter-todo:project-scan", async ({ messages = [], errors = [] } = {}) => {
      if (scanId !== this.scanId || !this.indieDelegate) return;
      receivedResults = true;
      messages = await this.filterIgnoredMessages(messages);
      if (scanId !== this.scanId || !this.indieDelegate) return;

      this.indieDelegate.setAllMessages(messages, {
        showProjectView: true,
      });

      for (const error of errors) {
        console.error("[linter-todo] Project scan failed:", error);
        atom.notifications.addWarning("TODO project scan failed", {
          detail: error.projectPath ? `${error.projectPath}\n\n${error.message}` : error.message,
          dismissable: true,
        });
      }

      this.scanning = false;
      this.task = null;
      this.disposeBusyMessage();
    });
  }

  dispose() {
    this.scanId++;
    if (this.task && typeof this.task.terminate === "function") {
      this.task.terminate();
    }
    this.task = null;
    this.disposeBusyMessage();
    this.scanning = false;
    this.busySignal = null;
    this.treeView = null;
    this.main = null;
    this.indieDelegate = null;
  }
}

module.exports = new ProjectLinter();
