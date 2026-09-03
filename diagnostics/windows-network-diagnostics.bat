@echo off
REM ============================================================
REM NEX AI - Phase 71 Windows Network Diagnostics
REM ============================================================
REM Run this on Windows to collect network/environment info.
REM
REM Usage: diagnostics\windows-network-diagnostics.bat
REM ============================================================

echo.
echo ============================================================
echo NEX AI - Phase 71 Windows Network Diagnostics
echo ============================================================
echo.

echo --- Node Version ---
node --version
echo.

echo --- npm Version ---
call npm --version
echo.

echo --- Electron Version (if installed) ---
call npm ls electron 2>nul
echo.

echo --- OS Info ---
ver
echo Processor: %PROCESSOR_ARCHITECTURE%
echo Computer: %COMPUTERNAME%
echo.

echo --- Proxy Environment Variables ---
echo HTTP_PROXY=%HTTP_PROXY%
echo HTTPS_PROXY=%HTTPS_PROXY%
echo ALL_PROXY=%ALL_PROXY%
echo NO_PROXY=%NO_PROXY%
echo http_proxy=%http_proxy%
echo https_proxy=%https_proxy%
echo all_proxy=%all_proxy%
echo no_proxy=%no_proxy%
echo.

echo --- npm Proxy Config ---
call npm config get proxy
call npm config get https-proxy
echo.

echo --- DNS Resolution: huggingface.co ---
nslookup huggingface.co
echo.

echo --- DNS Resolution: us.aws.cdn.hf.co ---
nslookup us.aws.cdn.hf.co
echo.

echo --- curl Test: HuggingFace HEAD ---
where curl
curl.exe -I -L "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf" 2>&1
echo.

echo --- curl Test: Download 1MB ---
curl.exe -L -r 0-1048575 -o "%TEMP%\nex-test.gguf" "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf" 2>&1
echo.
echo Downloaded file:
dir "%TEMP%\nex-test.gguf"
echo.

echo --- Node HTTPS Diagnostic ---
node diagnostics\test-node-https.js
echo.

echo ============================================================
echo Diagnostics complete. Copy the output above and share it.
echo ============================================================
