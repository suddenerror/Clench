module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  rules: {
    // Anchor-аккаунты декодируются динамически без сгенерированных TS-типов
    // (см. docs/adr-001-manual-idl.md) — типизировать их точно нечем.
    "@typescript-eslint/no-explicit-any": "off"
  }
};
