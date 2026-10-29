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
!include "FileFunc.nsh"
!include "WordFunc.nsh"

!define APPNAME "Prabh's CSC"
!define APPKEY "PrabhsCSC"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Prabhs-CSC"
InstallDirRegKey HKCU "Software\${APPKEY}" "InstallDir"
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
Var AppUrl

; Always install into a folder of our own, even if /D= points somewhere else,
; so the uninstaller can never remove files that are not ours.
Function .onInit
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "Prabhs-CSC"
    StrCpy $INSTDIR "$INSTDIR\Prabhs-CSC"
  ${EndIf}
FunctionEnd

; file:/// URL for the app page. Uses the short (8.3, ASCII-only) path when Windows
; has one, with forward slashes, so Edge's --app never misreads the path.
Function MakeAppUrl
  GetFullPathName /SHORT $0 "$INSTDIR"
  ${If} $0 == ""
    StrCpy $0 "$INSTDIR"
  ${EndIf}
  StrCpy $0 "$0\index.html"
  ${WordReplace} "$0" "\" "/" "+" $0
  ${WordReplace} "$0" " " "%20" "+" $0
  StrCpy $AppUrl "file:///$0"
FunctionEnd

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
    CreateShortCut "${LINK}" "$EdgePath" '--app="$AppUrl"' "$INSTDIR\app.ico" 0 SW_SHOWNORMAL "" "Browse and install Claude skills"
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
  Delete "$INSTDIR\index.html"
  Delete "$INSTDIR\app.js"
  Delete "$INSTDIR\boot.js"
  Delete "$INSTDIR\app.ico"
  RMDir /r "$INSTDIR\data"
  File /r "${STAGE}\*.*"

  Call FindEdge
  Call MakeAppUrl
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
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
  WriteRegStr HKCU "Software\${APPKEY}" "InstallDir" "$INSTDIR"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  ; Remove only what the installer put there, then the folder if it is now empty.
  Delete "$INSTDIR\index.html"
  Delete "$INSTDIR\app.js"
  Delete "$INSTDIR\boot.js"
  Delete "$INSTDIR\app.ico"
  RMDir /r "$INSTDIR\data"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPKEY}"
SectionEnd
