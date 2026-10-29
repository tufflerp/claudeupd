; Prabh's CSC - Windows installer (NSIS 3).
;
; Built by scripts/skill-connector-installer.js, which stages the app and passes:
;   /DSTAGE=<folder with index.html, app.js, boot.js, data/>  /DOUTFILE=<setup.exe>  /DVERSION=<x.y.z>
;
; Per-user install (no admin rights): files go to %LOCALAPPDATA%\Programs\Prabhs-CSC.
; The Start-menu and desktop shortcuts open the app in its own Microsoft Edge window
; (app mode), where one-click install into Claude Code works. Without Edge they open
; the app in the default browser.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APPNAME "Prabh's CSC"
!define APPKEY "PrabhsCSC"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Prabhs-CSC"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} installer (Claude Skill Connector)"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${APPNAME}"

!define MUI_ICON "${STAGE}\app.ico"
!define MUI_UNICON "${STAGE}\app.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "${APPNAME} (Claude Skill Connector) lets you browse safety-checked skills and install them into Claude Code with one click.$\r$\n$\r$\nIt installs just for you, so no administrator rights are needed."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APPNAME} now"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var EdgePath

; Find Microsoft Edge; empty when it is not installed.
Function FindEdge
  StrCpy $EdgePath ""
  ${If} ${FileExists} "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
    StrCpy $EdgePath "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
    StrCpy $EdgePath "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    StrCpy $EdgePath "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  ${EndIf}
FunctionEnd

; Create one shortcut that opens the app (in an Edge app window when possible).
!macro AppShortcut LINK
  ${If} $EdgePath != ""
    CreateShortCut "${LINK}" "$EdgePath" '--app="$INSTDIR\index.html"' "$INSTDIR\app.ico" 0 SW_SHOWNORMAL "" "Browse and install Claude skills"
  ${Else}
    CreateShortCut "${LINK}" "$INSTDIR\index.html" "" "$INSTDIR\app.ico" 0 SW_SHOWNORMAL "" "Browse and install Claude skills"
  ${EndIf}
!macroend

Function OpenApp
  ExecShell "open" "$SMPROGRAMS\${APPNAME}.lnk"
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  ; Replace an older version completely so removed files do not linger.
  RMDir /r "$INSTDIR\data"
  File /r "${STAGE}\*.*"

  Call FindEdge
  !insertmacro AppShortcut "$SMPROGRAMS\${APPNAME}.lnk"
  !insertmacro AppShortcut "$DESKTOP\${APPNAME}.lnk"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
SectionEnd
