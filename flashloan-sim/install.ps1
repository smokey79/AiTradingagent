# install.ps1 - installs Hardhat for the flash-loan simulator INSIDE this folder only (never a system folder)
$here = 'F:\aitradingagent\flashloan-sim'
if (-not (Test-Path "$here\package.json")) { throw "package.json missing in $here - refusing to run npm elsewhere" }
Set-Location $here
# --include=dev: this PC's npm config omits devDependencies by default, which silently skipped Hardhat
npm install --include=dev --no-audit --no-fund --loglevel=error *> "$here\npm-install.log"
"hardhat installed locally: " + (Test-Path "$here\node_modules\hardhat\package.json")
"npm exit code: $LASTEXITCODE"
