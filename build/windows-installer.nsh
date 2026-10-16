; Stable generic path. The public display name may change independently.
!macro customInit
  ; initMultiUser already resolved an existing installation or an explicit /D.
  ; Only supply our generic default for a genuinely new, unspecified location.
  ${If} $perUserInstallationFolder == ""
    !insertmacro GetDParameter $R0
    ${If} $R0 == ""
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\WorkspaceDesktop"
    ${EndIf}
  ${EndIf}
!macroend
; User profiles are deliberately outside $INSTDIR. Never remove them here.
