import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Never glob test files from agent git worktrees (Agent/Workflow isolation
    // checks out copies under .claude/worktrees/**); their scratch/in-progress
    // tests would otherwise run and false-fail the suite.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
