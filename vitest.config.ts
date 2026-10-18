import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Local agent worktrees under .claude/ carry their own copies of the suites; never run them from here.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
