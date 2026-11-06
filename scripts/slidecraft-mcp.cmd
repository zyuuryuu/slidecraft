@echo off
rem slidecraft-mcp.cmd -- launch the bundled SlideCraft MCP server with the bundled Node runtime (Windows).
rem
rem Ships as a Tauri bundle resource next to SlideCraft.exe in the install dir (NSIS default:
rem %LOCALAPPDATA%\SlideCraft ; MSI: %ProgramFiles%\SlideCraft). Tauri's NSIS/WiX templates copy both
rem `resources` (this file, cli.cjs) and `externalBin` sidecars (node.exe) FLAT into that dir, so
rem everything is resolved relative to this script's own folder: %~dp0 = drive + path, trailing "\".
rem The installer puts that folder on the USER PATH (src-tauri/windows/slidecraft-mcp-path.nsh / .wxs),
rem so an upstream agent registers the server with one word, exactly like the macOS Homebrew cask:
rem
rem   claude mcp add slidecraft -- slidecraft-mcp
rem   rem or, in a mcp.json:  {"command": "slidecraft-mcp"}
rem
rem Needs NO system Node (ADR-0022). Only if node.exe is somehow missing next to this script does it
rem fall back to whatever `node` is on PATH. Arguments (e.g. --root <dir>) pass through verbatim (%*),
rem and the server's exit code is this script's exit code.
setlocal
set "SLIDECRAFT_NODE=%~dp0node.exe"
if not exist "%~dp0node.exe" set "SLIDECRAFT_NODE=node"
"%SLIDECRAFT_NODE%" "%~dp0cli.cjs" %*
exit /b %ERRORLEVEL%
