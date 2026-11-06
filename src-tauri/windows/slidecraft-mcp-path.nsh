; slidecraft-mcp-path.nsh — Tauri NSIS installer hooks (bundle.windows.nsis.installerHooks in
; tauri.bundle.conf.json). Compiled into SlideCraft_<ver>_x64-setup.exe by `tauri build` on Windows.
;
; WHY: put the install dir — where slidecraft-mcp.cmd, node.exe and cli.cjs live, flat — on the USER
; PATH, so an upstream agent registers the bundled MCP server with ONE word, exactly like the macOS
; Homebrew cask does (#519 / ADR-0022 / ADR-0038 D5):
;
;   claude mcp add slidecraft -- slidecraft-mcp
;
; Contract (the #519 invariants):
;   * USER scope only: HKCU\Environment\Path. Never HKLM — no admin needed (Tauri's default NSIS mode
;     is currentUser → %LOCALAPPDATA%\SlideCraft). Even in a perMachine build this edits the installing
;     user's own PATH, never the machine PATH.
;   * Reversible: NSIS_HOOK_PREUNINSTALL removes exactly the entry we added. (PRE, not POST: Tauri's
;     template deletes the files right after this hook, while $INSTDIR is still the install dir.)
;   * Never silent: every step is DetailPrint-ed into the installer's details pane; a refusal pops a
;     MessageBox, always with a /SD default so silent/passive runs (incl. the in-app updater) never hang.
;   * Fail-safe, not lossy: NSIS string registers hold NSIS_MAX_STRLEN chars (1024 in the stock
;     NSIS 3.11 build Tauri downloads). ReadRegStr would silently TRUNCATE a longer PATH and we would
;     then write the truncated value back — corrupting the user's PATH. So if the current PATH (plus
;     our entry) does not fit, we refuse to touch PATH and tell the user how to add it by hand.
;   * Idempotent: the entry is stripped before it is appended, so reinstall / update / repair never
;     duplicates it. The strip is an exact-string match: we only ever remove what we ourselves wrote.
;
; Provided by the Tauri template that !includes this file: MUI2 (→ WinMessages: ${HWND_BROADCAST},
; ${WM_WININICHANGE}), LogicLib, WordFunc.nsh (${WordReplace} — an artificial function, usable in both
; the installer and the uninstaller), StrFunc.nsh.
;
; Content-pinned by tests/mcp-launcher-win-linux.test.ts (this file cannot be compiled on Linux CI).

!ifndef NSIS_MAX_STRLEN
  !define NSIS_MAX_STRLEN 1024 ; makensis predefines this; the fallback is the stock-build value
!endif
; Largest PATH we can round-trip without truncation: the register limit minus the ";" we add and NUL.
!define /math SLIDECRAFT_PATH_BUDGET ${NSIS_MAX_STRLEN} - 2

; Tell running shells / Explorer that the environment changed, so NEW terminals see PATH at once
; (no logoff). Existing terminals keep their old environment — that is normal Windows behaviour.
!macro SLIDECRAFT_BROADCAST_ENVIRONMENT
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

; Remove every exact occurrence of the entry in $R9 from the ";"-separated PATH in $R0 (in place).
; Technique: wrap in ";" so first/last/only entries all look like ";<entry>;", replace ALL ("+") such
; words with a single ";", then unwrap. Uses $R1 as scratch.
!macro SLIDECRAFT_PATH_STRIP_ENTRY
  StrCpy $R0 ";$R0;"
  ${WordReplace} $R0 ";$R9;" ";" "+" $R0
  StrCpy $R1 $R0 1
  ${If} $R1 == ";"
    StrCpy $R0 $R0 "" 1
  ${EndIf}
  StrCpy $R1 $R0 1 -1
  ${If} $R1 == ";"
    StrCpy $R0 $R0 -1
  ${EndIf}
!macroend

; ── Install: runs after the main exe, resources (slidecraft-mcp.cmd, cli.cjs) and sidecars (node.exe)
;    have been copied into $INSTDIR, and after the uninstaller + registry entries were written.
!macro NSIS_HOOK_POSTINSTALL
  StrCpy $R9 "$INSTDIR"
  DetailPrint "MCP launcher: adding $R9 to the user PATH (so `slidecraft-mcp` is a command)"
  ClearErrors
  ReadRegStr $R0 HKCU "Environment" "Path"
  ${If} ${Errors}
    StrCpy $R0 "" ; no user PATH value yet — we will create it
  ${EndIf}
  StrLen $R1 $R0
  StrLen $R2 $R9
  IntOp $R2 $R2 + $R1
  IntOp $R2 $R2 + 1 ; the ";" separator we add
  ${If} $R1 >= ${SLIDECRAFT_PATH_BUDGET}
  ${OrIf} $R2 > ${SLIDECRAFT_PATH_BUDGET}
    ; Either ReadRegStr may already have truncated the value, or appending would overflow. Do no harm.
    DetailPrint "MCP launcher: user PATH is too long ($R1 chars) for this installer to edit safely — left unchanged"
    MessageBox MB_ICONEXCLAMATION|MB_OK "SlideCraft could not add its MCP launcher folder to your PATH: your user PATH is longer ($R1 characters) than this installer can edit safely, so it was left untouched.$\r$\n$\r$\nTo register the MCP server anyway, add this folder to your user PATH by hand and reopen your terminal:$\r$\n$R9$\r$\n$\r$\n(Settings > System > About > Advanced system settings > Environment Variables > User variables > Path)" /SD IDOK
  ${Else}
    !insertmacro SLIDECRAFT_PATH_STRIP_ENTRY
    ${If} $R0 == ""
      StrCpy $R0 "$R9"
    ${Else}
      StrCpy $R0 "$R0;$R9"
    ${EndIf}
    ClearErrors
    WriteRegExpandStr HKCU "Environment" "Path" "$R0"
    ${If} ${Errors}
      DetailPrint "MCP launcher: could not write the user PATH (registry error) — left unchanged"
      MessageBox MB_ICONEXCLAMATION|MB_OK "SlideCraft could not update your user PATH (registry write failed). To register the MCP server, add this folder to your user PATH by hand:$\r$\n$R9" /SD IDOK
    ${Else}
      !insertmacro SLIDECRAFT_BROADCAST_ENVIRONMENT
      DetailPrint "MCP launcher: user PATH updated. Register with: claude mcp add slidecraft -- slidecraft-mcp"
    ${EndIf}
  ${EndIf}
!macroend

; ── Uninstall: runs BEFORE Tauri's template deletes the files, with $INSTDIR = the install dir.
!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $R9 "$INSTDIR"
  DetailPrint "MCP launcher: removing $R9 from the user PATH"
  ClearErrors
  ReadRegStr $R0 HKCU "Environment" "Path"
  ${If} ${Errors}
    DetailPrint "MCP launcher: no user PATH value — nothing to remove"
  ${Else}
    StrLen $R1 $R0
    ${If} $R1 >= ${SLIDECRAFT_PATH_BUDGET}
      ; The value may have been truncated by ReadRegStr; writing it back would corrupt PATH. Do no harm.
      DetailPrint "MCP launcher: user PATH is too long ($R1 chars) to edit safely — left unchanged"
      MessageBox MB_ICONEXCLAMATION|MB_OK "SlideCraft could not remove its folder from your user PATH: the PATH is longer ($R1 characters) than this uninstaller can edit safely, so it was left untouched. You can remove this entry by hand:$\r$\n$R9" /SD IDOK
    ${Else}
      StrCpy $R2 "$R0" ; remember the original to detect 'nothing to do'
      !insertmacro SLIDECRAFT_PATH_STRIP_ENTRY
      ${If} $R0 == $R2
        DetailPrint "MCP launcher: $R9 was not on the user PATH — nothing to remove"
      ${ElseIf} $R0 == ""
        DeleteRegValue HKCU "Environment" "Path" ; it held only our entry (we created it) — leave no empty value
        !insertmacro SLIDECRAFT_BROADCAST_ENVIRONMENT
        DetailPrint "MCP launcher: removed from the user PATH (the value held only this entry and was deleted)"
      ${Else}
        WriteRegExpandStr HKCU "Environment" "Path" "$R0"
        !insertmacro SLIDECRAFT_BROADCAST_ENVIRONMENT
        DetailPrint "MCP launcher: removed from the user PATH"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
