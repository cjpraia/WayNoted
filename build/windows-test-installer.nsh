; Test packages must not replace a user's production installation.
!macro customInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\WorkspaceDesktopTest"
!macroend
