# Installs Claude Code (Anthropic's official agentic coding CLI) on native Windows.
# Source: https://docs.claude.com/en/docs/claude-code/setup
# Git for Windows is optional: without it, Claude Code uses the PowerShell tool
# for shell commands instead of the Bash tool. Nothing else on the system is required.

Write-Host "Installing Claude Code..." -ForegroundColor Cyan
irm https://claude.ai/install.ps1 | iex

Write-Host ""
Write-Host "Checking installed version..." -ForegroundColor Cyan
try {
    claude --version
} catch {
    Write-Host "claude command not found on PATH yet. Close and reopen your terminal, then run 'claude --version'." -ForegroundColor Yellow
}
