const globals = require("globals");
const sonarjs = require("eslint-plugin-sonarjs");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "paired-frontend/**",
    ],
  },
  sonarjs.configs.recommended,
  { files: ["e2e/**/*.js"], languageOptions: { globals: globals.browser } },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: "error",
    },
  },
];
