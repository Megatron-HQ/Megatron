import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // shadcn/ui components are vendored via `npx shadcn add`, not hand-written —
    // don't hold generated code to hand-written return-type/export conventions.
    files: ['src/renderer/src/components/ui/**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    // ESM only, everywhere — see "Module system" in CLAUDE.md's locked decisions.
    files: ['**/*.{ts,tsx,mjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'require', message: 'ESM only — use import.' },
        { name: 'module', message: 'ESM only — use export.' },
        { name: 'exports', message: 'ESM only — use export.' },
        { name: '__dirname', message: 'ESM only — use import.meta.dirname.' },
        { name: '__filename', message: 'ESM only — use import.meta.filename.' }
      ]
    }
  },
  eslintConfigPrettier
)
