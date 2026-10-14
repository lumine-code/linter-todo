// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "language-todo", "linter", "linter-panel"],
  viewport: { width: 1100, height: 530 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("todo/signal.js");
    await lumine.project.setPaths([fixture("todo")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Collect TODO and FIXME annotations as navigable diagnostics.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "linter-todo:lint-projects");
          await new Promise((resolve) => setTimeout(resolve, 1600));
        }
        {
          await lumine.workspace.open("lumine://linter-panel");
          lumine.workspace.getBottomDock().setState({ size: 190 });
          lumine.workspace.getBottomDock().show();
        }
      },
      ready() {
        return Boolean(document.querySelector(".linter-panel")?.innerText.includes("TODO"));
      },
    },
  ],
  async cleanup() {},
};
