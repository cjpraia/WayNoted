; Test packages must not replace a user's production installation.
!macro customInit
  ${If} $perUserInstallationFolder == ""
    !insertmacro GetDParameter $R0
    ${If} $R0 == ""
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\WorkspaceDesktopTest"
    ${EndIf}
  ${EndIf}
!macroend
