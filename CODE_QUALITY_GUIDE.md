# Code Quality & Formatting Guide

## Overview

This project now includes comprehensive code quality checking and formatting tools to maintain consistency across the JavaScript/TypeScript codebase.

## Tools Installed

### 1. **ESLint** - Code Quality & Linting
- **Config**: `.eslintrc.json`
- **Purpose**: Catches bugs, enforces coding standards, and identifies problematic patterns
- **Features**:
  - JavaScript ES2021+ support
  - Browser and Node.js environment detection
  - Code style enforcement
  - Complexity warnings
  - Unused variable detection

### 2. **Prettier** - Code Formatting
- **Config**: `.prettierrc.json`
- **Purpose**: Automatic code formatting for consistent style
- **Features**:
  - 2-space indentation
  - Single quotes preference
  - Automatic semicolon insertion
  - Print width of 120 characters
  - Trailing commas in ES5-compatible format

### 3. **EditorConfig** - Editor Integration
- **Config**: `.editorconfig`
- **Purpose**: Maintains consistent coding styles across different editors and IDEs
- **Supported**: VS Code, WebStorm, Sublime Text, and most modern editors

## Usage

### Check Code Quality (Read-Only)
```bash
npm run lint
```
Runs ESLint on all JavaScript/TypeScript files and fails if there are issues.

### Automatically Fix Issues
```bash
npm run lint:fix
```
Runs ESLint with the `--fix` flag to automatically resolve fixable issues.

### Check Formatting
```bash
npm run format:check
```
Verifies that code matches Prettier's formatting rules (doesn't modify files).

### Auto-Format Code
```bash
npm run format
```
Automatically formats all code files to match Prettier's rules.

### Run All Quality Checks
```bash
npm run check
```
Runs both formatting and linting checks in sequence.

### Fix Everything
```bash
npm run fix
```
Automatically formats code and fixes linting issues.

### Generate ESLint Report (JSON)
```bash
npm run lint:report
```
Creates an `eslint-report.json` file for CI/CD integration or detailed analysis.

## Configuration Details

### ESLint Rules

#### Code Style
- **Indentation**: 2 spaces
- **Quotes**: Single quotes (with backtick support for templates)
- **Semicolons**: Required at end of statements
- **Line breaks**: Unix-style (LF)
- **Line length**: Warning at 120 characters
- **Trailing spaces**: Not allowed

#### Best Practices
- **var**: Prohibited (use `const` or `let`)
- **Strict equality**: Enforced (`===` instead of `==`)
- **Curly braces**: Required for all blocks
- **Arrow functions**: Preferred for callbacks
- **Implicit coercion**: Not allowed
- **Nested ternaries**: Not allowed
- **Console usage**: Warnings allowed for `.warn()`, `.error()`, `.info()`, `.debug()`

#### Code Complexity
- **Function complexity**: Warning if > 15
- **Nesting depth**: Warning if > 4 levels
- **Callback nesting**: Warning if > 3 levels

### ESLint Ignore Patterns

The `.eslintignore` file excludes:
- `node_modules/`
- `build/`, `dist/`
- Build artifacts (e.g., `src/dashboard/public/assets/`)
- Python cache and virtual environments
- IDE settings
- Environment files

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Code Quality

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run check
```

### Pre-commit Hook (Husky)

To set up automatic checks before commits (optional):

```bash
npm install husky lint-staged --save-dev
npx husky install
npx husky add .husky/pre-commit "npm run lint:fix && npm run format"
```

## IDE Integration

### VS Code
The `.editorconfig` file is automatically recognized. Install the **EditorConfig for VS Code** extension for full support.

**Recommended Extensions**:
- ESLint (official Microsoft extension)
- Prettier - Code formatter
- EditorConfig for VS Code

**Settings** (add to `.vscode/settings.json`):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ],
  "eslint.format.enable": true
}
```

### WebStorm / IntelliJ IDEA
- Both tools have native ESLint and Prettier support
- Settings > Languages & Frameworks > JavaScript > Code Quality Tools
- Select ESLint and Prettier from the dropdowns

## Troubleshooting

### ESLint Not Found
```bash
npm install
```

### Prettier Conflicts with ESLint
Both tools are configured to work together:
- Prettier handles formatting
- ESLint handles code quality rules
- No conflicting rules should exist

### Too Many Warnings
If you have many existing warnings:
1. Run `npm run lint:report` to see all issues
2. Run `npm run lint:fix` to auto-fix what can be fixed
3. Address remaining issues manually

### Port Windows/CRLF Issues
The `.editorconfig` ensures Unix line endings (LF) for source code:
- Already configured in `.editorconfig`
- Git should handle conversion: `git config core.safecrlf true`

## Customization

### Adjusting Rules
Edit `.eslintrc.json`:
- Set rule to `"off"` to disable
- Set rule to `"warn"` for warnings only
- Set rule to `"error"` for hard failures
- Adjust rule severity and options as needed

### Changing Format Preferences
Edit `.prettierrc.json` to modify:
- `printWidth`: Change the line length limit
- `tabWidth`: Change indentation size
- `singleQuote`: Toggle between single/double quotes
- `semi`: Toggle semicolon requirement
- Other Prettier options

### Ignoring Files/Patterns
Add patterns to `.eslintignore`:
```
*.test.js
**/vendor/**
docs/**
```

## Best Practices

1. **Run checks before committing**: Use `npm run check` regularly
2. **Fix automatically**: Use `npm run fix` to resolve most issues quickly
3. **Review remaining issues**: Manually fix any issues that can't be auto-fixed
4. **Keep configuration updated**: Review and update rules as best practices evolve
5. **Document exceptions**: If disabling a rule for specific files, comment why

## Related Files

- `.eslintrc.json` - Main ESLint configuration
- `.prettierrc.json` - Prettier formatting rules
- `.eslintignore` - Files/patterns to exclude from linting
- `.editorconfig` - Cross-editor coding style settings
- `package.json` - NPM scripts and dependencies

## Additional Resources

- [ESLint Documentation](https://eslint.org/docs)
- [Prettier Documentation](https://prettier.io/docs)
- [EditorConfig](https://editorconfig.org)
- [JavaScript Standards Guide](https://github.com/airbnb/javascript)
