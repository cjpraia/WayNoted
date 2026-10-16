#!/bin/bash
# Cria (uma vez) o certificado AUTO-ASSINADO de assinatura de código "Workspace Local Signing" no Acesso às Chaves (login).
# Quem executa é VOCÊ, no Terminal:   bash build/make-signing-identity.sh
# Idempotente: se o certificado e a chave já existem, não faz nada. Nada sai do seu Mac.
# O macOS vai pedir a senha do chaveiro (importar a chave) e a senha de administrador/Touch ID (confiar no certificado
# apenas para assinatura de código). Depois use:  export WORKSPACE_SIGN_IDENTITY="Workspace Local Signing"
set -euo pipefail

NAME="${WORKSPACE_SIGN_IDENTITY_NAME:-Workspace Local Signing}"
KEYCHAIN="${WORKSPACE_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"
OPENSSL=/usr/bin/openssl

if [[ "$(uname)" != "Darwin" ]]; then echo "Este script é só para macOS." >&2; exit 1; fi

# Já existe um certificado com chave privada para esse nome? (find-identity sem -v lista também os não confiáveis)
if security find-identity -p codesigning "$KEYCHAIN" 2>/dev/null | grep -q "\"$NAME\""; then
  echo "OK: a identidade \"$NAME\" já existe em $KEYCHAIN. Nada a fazer."
  echo "Use:  export WORKSPACE_SIGN_IDENTITY=\"$NAME\""
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"
PASS="$($OPENSSL rand -hex 16)"

cat > "$WORK/openssl.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
O = Workspace (local)
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CNF

# Validade de 10 anos: trocar o certificado muda a identidade e repete as permissões do macOS.
$OPENSSL req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 -config "$WORK/openssl.cnf" \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" 2>/dev/null
$OPENSSL pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -name "$NAME" \
  -out "$WORK/identity.p12" -passout "pass:$PASS" 2>/dev/null

# -T: permite que o codesign use a chave sem perguntar a cada build.
security import "$WORK/identity.p12" -k "$KEYCHAIN" -f pkcs12 -P "$PASS" -T /usr/bin/codesign
# Confiança restrita a assinatura de código (não vira autoridade para HTTPS/e-mail).
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$WORK/cert.pem"

echo
echo "Pronto. Identidade criada:"
security find-identity -p codesigning "$KEYCHAIN" | grep "\"$NAME\"" || true
echo
echo "Próximo passo:  export WORKSPACE_SIGN_IDENTITY=\"$NAME\"  &&  npm run dist"
echo "Se o macOS perguntar sobre a chave ao assinar, escolha \"Permitir sempre\"."
