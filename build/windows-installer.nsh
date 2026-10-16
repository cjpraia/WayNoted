; Stable generic path. The public display name may change independently.
!macro customInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\WorkspaceDesktop"
!macroend
; User profiles are deliberately outside $INSTDIR. Never remove them here.
