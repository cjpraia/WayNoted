import PRODUCT from '../shared/product.json' with { type: 'json' }
// O texto integral fica em LICENSE; os identificadores ficam em shared/product.json.
// Dependências mantêm suas próprias licenças (THIRD-PARTY-NOTICES.md).
export const WORKSPACE_LICENSE = {
  pt: `Licença do ${PRODUCT.name}: ${PRODUCT.license} — uso não comercial permitido. Uso comercial exige autorização separada do titular.`,
  en: `${PRODUCT.name} license: ${PRODUCT.license} — noncommercial use permitted. Commercial use requires separate permission from the licensor.`,
}

export const BLOCKNOTE_NOTICE = {
  pt: `O ${PRODUCT.name} usa software de código aberto. Os arquivos do editor BlockNote (licença MPL-2.0) são distribuídos sem modificação; o código-fonte original está em https://github.com/TypeCellOS/BlockNote e a licença em https://www.mozilla.org/MPL/2.0/. Para os demais componentes veja a lista abaixo.`,
  en: `${PRODUCT.name} uses open-source software. The BlockNote editor files (MPL-2.0 license) are distributed without modification; the original source code is at https://github.com/TypeCellOS/BlockNote and the license at https://www.mozilla.org/MPL/2.0/. For the other components see the list below.`,
}
