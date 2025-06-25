import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: { "no-unused-vars": "warn" },
  },

  // Node environment (Electron main/preload scripts)
  {
    files: ["src/**"],
    ignores: ["src/html_files/**"], // exclude browser files from this node block
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Browser environment (Electron renderer scripts)
  {
    files: ["src/html_files/**"],
    languageOptions: {
      globals: {
        ...globals.browser,
        Electron: "readonly", // allow window.Electron bridge
      },
    },
  },
]);
