import { EMOJI_ENGLISH } from './emojiEnglish.ts'
// Conjunto próprio de emojis para o seletor de ícone da página.
// Formato: "emoji nomes de busca" separados por "|".

export interface EmojiItem {
  emoji: string
  keywords: string
  english?: string
}

export interface EmojiCategory {
  id: string
  label: string
  items: EmojiItem[]
}

function parse(raw: string): EmojiItem[] {
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(' ')
      const emoji = i < 0 ? s : s.slice(0, i)
      return { emoji, keywords: i < 0 ? '' : s.slice(i + 1).toLowerCase(), english: EMOJI_ENGLISH[emoji] || '' }
    })
}

const raw: [string, string, string][] = [
  [
    'rostos',
    'Rostos e emoções',
    `😀 sorriso feliz rindo|😃 sorriso alegre|😄 sorriso olhos felizes|😁 sorriso dentes|😆 gargalhada rindo|😅 suor nervoso riso|🤣 rolando de rir|😂 lágrimas de alegria chorando de rir|🙂 sorriso leve|🙃 de cabeça para baixo|😉 piscadela|😊 sorriso corado|😇 anjo auréola|🥰 apaixonado corações|😍 olhos de coração amor|🤩 deslumbrado estrelas|😘 beijo|😗 beijando|😚 beijo olhos fechados|😋 delicioso gostoso|😛 língua|😜 piscando língua|🤪 maluco doido|😝 língua olhos fechados|🤑 dinheiro rico|🤗 abraço|🤭 mão na boca ops|🤫 silêncio segredo|🤔 pensando dúvida|🤐 boca fechada zíper|🤨 sobrancelha desconfiado|😐 neutro|😑 sem expressão|😶 sem boca|😏 sorriso malicioso|😒 entediado|🙄 revirando olhos|😬 careta|😮‍💨 suspiro alívio|🤥 mentiroso|😌 aliviado calmo|😔 pensativo triste|😪 sonolento|🤤 babando|😴 dormindo sono|😷 máscara doente|🤒 febre termômetro|🤕 machucado|🤢 enjoado|🤮 vomitando|🤧 espirro gripe|🥵 calor quente|🥶 frio gelado|🥴 tonto|😵 atordoado|🤯 cabeça explodindo chocado|🤠 caubói|🥳 festa comemorando|🥸 disfarce|😎 óculos escuros legal|🤓 nerd estudioso|🧐 monóculo curioso|😕 confuso|😟 preocupado|🙁 triste leve|😮 surpreso boca aberta|😯 espantado|😲 chocado|😳 envergonhado corado|🥺 suplicando olhos|😦 assustado|😧 angustiado|😨 medo|😰 ansioso suor|😥 decepcionado aliviado|😢 chorando lágrima|😭 chorando muito|😱 gritando medo|😖 confuso frustrado|😣 perseverante|😞 desapontado|😓 suor frio|😩 exausto cansado|😫 cansado|🥱 bocejo tédio|😤 bufando orgulho|😡 furioso bravo|😠 bravo raiva|🤬 xingando|😈 diabinho sorrindo|👿 diabinho bravo|💀 caveira morte|☠️ caveira ossos|💩 cocô|🤡 palhaço|👹 ogro|👺 goblin|👻 fantasma|👽 alienígena et|👾 monstro jogo|🤖 robô|😺 gato sorrindo|😸 gato feliz|😹 gato rindo|😻 gato apaixonado|😼 gato irônico|🙀 gato assustado|😿 gato chorando|😾 gato bravo|🙈 macaco não vejo|🙉 macaco não ouço|🙊 macaco não falo|💋 beijo lábios|💌 carta de amor|💘 coração flecha|💝 coração presente|💖 coração brilhante|💗 coração crescendo|💓 coração batendo|💞 corações girando|💕 dois corações|❣️ exclamação coração|💔 coração partido|❤️ coração vermelho amor|🧡 coração laranja|💛 coração amarelo|💚 coração verde|💙 coração azul|💜 coração roxo|🤎 coração marrom|🖤 coração preto|🤍 coração branco|💯 cem pontos|💢 raiva|💥 colisão explosão|💫 tontura estrela|💦 gotas suor|💨 vento rápido|💬 balão fala conversa|💭 balão pensamento|💤 sono zzz`,
  ],
  [
    'pessoas',
    'Pessoas e gestos',
    `👋 aceno olá tchau|🤚 mão levantada|🖐️ mão aberta|✋ mão parar|🖖 saudação vulcana|👌 ok perfeito|🤌 dedos juntos|🤏 pouquinho|✌️ paz vitória|🤞 dedos cruzados sorte|🤟 te amo|🤘 rock|🤙 me liga|👈 apontando esquerda|👉 apontando direita|👆 apontando cima|👇 apontando baixo|☝️ indicador|👍 joinha positivo curtir|👎 negativo|✊ punho|👊 soco|🤛 punho esquerda|🤜 punho direita|👏 palmas aplausos|🙌 mãos para cima celebrar|👐 mãos abertas|🤲 mãos juntas|🤝 aperto de mão acordo|🙏 por favor obrigado reza|✍️ escrevendo|💅 esmalte unha|🤳 selfie|💪 forte músculo|🦾 braço mecânico|🧠 cérebro mente|🫀 coração órgão|🫁 pulmões|🦷 dente|🦴 osso|👀 olhos olhando|👁️ olho|👅 língua|👄 boca|👶 bebê|🧒 criança|👦 menino|👧 menina|🧑 pessoa|👨 homem|👩 mulher|🧓 idoso|👴 vovô|👵 vovó|🧑‍💻 programador tecnólogo computador|🧑‍🎨 artista|🧑‍🍳 cozinheiro chef|🧑‍🏫 professor|🧑‍🎓 estudante formatura|🧑‍🔬 cientista|🧑‍🚀 astronauta|🧑‍⚕️ médico saúde|🧑‍🌾 agricultor|🧑‍🔧 mecânico|🧑‍💼 executivo escritório|🕵️ detetive|👷 construção obra|🤴 príncipe|👸 princesa|🦸 super-herói|🦹 vilão|🧙 mago|🧚 fada|🧛 vampiro|🧜 sereia|🧝 elfo|🧞 gênio|🧟 zumbi|💆 massagem|💇 corte de cabelo|🚶 andando caminhada|🏃 correndo corrida|💃 dançarina|🕺 dançando|🧘 meditação ioga|🛀 banho|🛌 cama dormir|👫 casal|👪 família|🗣️ falando|👤 silhueta pessoa|👥 pessoas grupo|👣 pegadas`,
  ],
  [
    'natureza',
    'Animais e natureza',
    `🐶 cachorro cão|🐱 gato|🐭 rato|🐹 hamster|🐰 coelho|🦊 raposa|🐻 urso|🐼 panda|🐨 coala|🐯 tigre|🦁 leão|🐮 vaca|🐷 porco|🐸 sapo|🐵 macaco|🐔 galinha|🐧 pinguim|🐦 pássaro|🐤 pintinho|🦆 pato|🦅 águia|🦉 coruja|🦇 morcego|🐺 lobo|🐗 javali|🐴 cavalo|🦄 unicórnio|🐝 abelha|🐛 lagarta|🦋 borboleta|🐌 caracol|🐞 joaninha|🐜 formiga|🕷️ aranha|🦂 escorpião|🐢 tartaruga|🐍 cobra|🦎 lagarto|🦖 dinossauro t-rex|🦕 dinossauro|🐙 polvo|🦑 lula|🦐 camarão|🦀 caranguejo|🐡 baiacu|🐠 peixe tropical|🐟 peixe|🐬 golfinho|🐳 baleia|🦈 tubarão|🐊 crocodilo|🐅 tigre|🐆 leopardo|🦓 zebra|🦍 gorila|🐘 elefante|🦛 hipopótamo|🦏 rinoceronte|🐪 camelo|🦒 girafa|🦘 canguru|🐃 búfalo|🐑 ovelha|🦙 lhama|🐐 cabra|🦌 cervo|🐕 cachorro|🐈 gato|🦜 papagaio arara|🦢 cisne|🦩 flamingo|🕊️ pomba paz|🐇 coelho|🦝 guaxinim|🦨 gambá|🦦 lontra|🦥 preguiça|🐿️ esquilo|🦔 ouriço|🐾 patas pegadas|🐉 dragão|🌵 cacto|🎄 árvore de natal|🌲 pinheiro|🌳 árvore|🌴 palmeira|🪴 planta vaso|🌱 broto muda|🌿 erva|☘️ trevo|🍀 trevo quatro folhas sorte|🎍 bambu|🍃 folhas vento|🍂 folhas outono|🍁 folha bordo|🍄 cogumelo|🐚 concha|🪨 pedra|🌾 trigo|💐 buquê flores|🌷 tulipa|🌹 rosa|🥀 rosa murcha|🌺 hibisco|🌸 flor de cerejeira|🌼 flor|🌻 girassol|🌞 sol sorrindo|🌝 lua cheia rosto|🌛 lua quarto|🌚 lua nova rosto|🌕 lua cheia|🌙 lua crescente|🌎 terra américas mundo|🌍 terra europa áfrica|🌏 terra ásia|🪐 planeta saturno|💫 estrela tontura|⭐ estrela|🌟 estrela brilhante|✨ brilhos mágica|⚡ raio energia|☄️ cometa|🔥 fogo|🌪️ tornado|🌈 arco-íris|☀️ sol|🌤️ sol nuvem|⛅ parcialmente nublado|☁️ nuvem|🌧️ chuva|⛈️ tempestade|🌩️ relâmpago|❄️ floco de neve|☃️ boneco de neve|⛄ boneco neve|🌬️ vento|💧 gota água|🌊 onda mar`,
  ],
  [
    'comida',
    'Comidas e bebidas',
    `🍏 maçã verde|🍎 maçã|🍐 pera|🍊 laranja|🍋 limão|🍌 banana|🍉 melancia|🍇 uvas|🍓 morango|🫐 mirtilo|🍈 melão|🍒 cereja|🍑 pêssego|🥭 manga|🍍 abacaxi|🥥 coco|🥝 kiwi|🍅 tomate|🍆 berinjela|🥑 abacate|🥦 brócolis|🥬 alface folhas|🥒 pepino|🌶️ pimenta|🌽 milho|🥕 cenoura|🧄 alho|🧅 cebola|🥔 batata|🍠 batata doce|🥐 croissant|🥯 bagel|🍞 pão|🥖 baguete|🧀 queijo|🥚 ovo|🍳 ovo frito cozinhar|🧈 manteiga|🥞 panquecas|🧇 waffle|🥓 bacon|🥩 carne|🍗 frango coxa|🍖 carne osso|🌭 cachorro-quente|🍔 hambúrguer|🍟 batata frita|🍕 pizza|🥪 sanduíche|🌮 taco|🌯 burrito|🥗 salada|🥘 paella panela|🍝 macarrão espaguete|🍜 lámen sopa|🍲 ensopado|🍛 curry|🍣 sushi|🍱 bentô|🥟 pastel dumpling|🍤 camarão frito|🍙 bolinho de arroz|🍚 arroz|🍘 biscoito arroz|🍢 espetinho|🍡 dango|🍧 raspadinha|🍨 sorvete|🍦 sorvete casquinha|🥧 torta|🧁 cupcake|🍰 bolo fatia|🎂 bolo aniversário|🍮 pudim|🍭 pirulito|🍬 bala doce|🍫 chocolate|🍿 pipoca|🍩 rosquinha donut|🍪 biscoito cookie|🌰 castanha|🥜 amendoim|🍯 mel|🥛 leite|🍼 mamadeira|☕ café|🍵 chá|🧃 suco caixinha|🥤 refrigerante copo|🧋 chá de bolha|🍶 saquê|🍺 cerveja|🍻 brinde cervejas|🥂 brinde taças|🍷 vinho|🥃 uísque|🍸 coquetel|🍹 drinque tropical|🧉 chimarrão mate|🧊 gelo|🥢 hashi|🍽️ prato talheres|🍴 garfo faca|🥄 colher`,
  ],
  [
    'atividades',
    'Atividades',
    `⚽ futebol bola|🏀 basquete|🏈 futebol americano|⚾ beisebol|🥎 softbol|🎾 tênis|🏐 vôlei|🏉 rúgbi|🥏 frisbee|🎱 sinuca|🏓 pingue-pongue|🏸 badminton|🏒 hóquei|🥅 gol|⛳ golfe|🏹 arco e flecha|🎣 pesca|🤿 mergulho|🥊 boxe|🥋 artes marciais|🎽 camiseta corrida|🛹 skate|🛼 patins|⛸️ patinação|🥌 curling|🎿 esqui|⛷️ esquiador|🏂 snowboard|🏋️ musculação academia|🤸 ginástica|⛹️ basquete jogador|🤺 esgrima|🏇 corrida de cavalo|🏄 surfe|🏊 natação|🚴 ciclismo bicicleta|🚵 mountain bike|🧗 escalada|🏆 troféu vitória|🥇 medalha ouro primeiro|🥈 medalha prata|🥉 medalha bronze|🏅 medalha|🎖️ medalha militar|🎗️ fita lembrete|🎫 ingresso|🎟️ bilhete|🎪 circo|🎭 teatro máscaras|🎨 paleta arte pintura|🎬 claquete cinema filme|🎤 microfone|🎧 fones de ouvido música|🎼 partitura|🎹 piano teclado|🥁 bateria tambor|🎷 saxofone|🎺 trompete|🎸 guitarra violão|🪕 banjo|🎻 violino|🎲 dado jogo|♟️ xadrez|🎯 alvo meta objetivo|🎳 boliche|🎮 videogame controle|🕹️ joystick|🧩 quebra-cabeça|🧸 ursinho|🪀 ioiô|🪁 pipa|🎉 festa confete|🎊 confete|🎈 balão|🎁 presente|🎀 laço|🎃 abóbora halloween|🎆 fogos de artifício|🎇 estrelinha|🧨 bombinha|🎐 sino de vento|🎑 lua festival|🎏 bandeira carpas`,
  ],
  [
    'viagens',
    'Viagens e lugares',
    `🚗 carro|🚕 táxi|🚙 suv|🚌 ônibus|🚎 trólebus|🏎️ carro de corrida|🚓 polícia|🚑 ambulância|🚒 bombeiros|🚐 van|🚚 caminhão entrega|🚛 carreta|🚜 trator|🛵 lambreta|🏍️ moto|🚲 bicicleta|🛴 patinete|🚨 sirene|🚔 viatura|🚍 ônibus chegando|🚘 carro chegando|🚖 táxi chegando|🚡 teleférico|🚠 bondinho|🚟 trem suspenso|🚃 vagão|🚋 bonde|🚞 trem montanha|🚝 monotrilho|🚄 trem bala|🚅 trem rápido|🚈 metrô leve|🚂 locomotiva|🚆 trem|🚇 metrô|✈️ avião viagem|🛫 decolagem|🛬 pouso|🛩️ avião pequeno|💺 assento|🛰️ satélite|🚀 foguete lançamento|🛸 disco voador|🚁 helicóptero|🛶 canoa|⛵ veleiro|🚤 lancha|🛳️ navio cruzeiro|⛴️ balsa|🚢 navio|⚓ âncora|⛽ combustível posto|🚧 obras construção|🚦 semáforo|🗺️ mapa|🗿 moai|🗽 estátua da liberdade|🗼 torre|🏰 castelo|🏯 castelo japonês|🏟️ estádio|🎡 roda-gigante|🎢 montanha-russa|🎠 carrossel|⛲ fonte|⛱️ guarda-sol|🏖️ praia|🏝️ ilha|🏜️ deserto|🌋 vulcão|⛰️ montanha|🏔️ montanha neve|🗻 monte fuji|🏕️ acampamento|⛺ barraca|🏠 casa lar|🏡 casa jardim|🏘️ casas bairro|🏚️ casa abandonada|🏗️ construção guindaste|🏭 fábrica|🏢 prédio escritório|🏬 loja departamento|🏣 correio|🏥 hospital|🏦 banco|🏨 hotel|🏪 loja conveniência|🏫 escola|🏩 motel|💒 casamento|🏛️ edifício clássico museu|⛪ igreja|🕌 mesquita|🕍 sinagoga|🛕 templo|🌁 neblina|🌃 noite estrelada cidade|🏙️ cidade|🌄 nascer do sol montanha|🌅 nascer do sol|🌆 cidade entardecer|🌇 pôr do sol|🌉 ponte noite|🌌 via láctea galáxia|🎑 lua|🧭 bússola|⏱️ cronômetro|⏰ despertador|⌛ ampulheta|🌐 globo internet`,
  ],
  [
    'objetos',
    'Objetos',
    `⌚ relógio|📱 celular telefone|💻 notebook computador|⌨️ teclado|🖥️ computador desktop|🖨️ impressora|🖱️ mouse|💽 minidisco|💾 disquete salvar|💿 cd|📀 dvd|📷 câmera foto|📸 câmera flash|📹 filmadora|🎥 câmera cinema|📞 telefone|☎️ telefone fixo|📺 televisão tv|📻 rádio|🎙️ microfone estúdio podcast|⏲️ timer|🕰️ relógio de mesa|🔋 bateria|🔌 tomada plugue|💡 lâmpada ideia|🔦 lanterna|🕯️ vela|🧯 extintor|💸 dinheiro voando|💵 dólar nota|💰 saco de dinheiro|💳 cartão de crédito|💎 diamante joia|⚖️ balança justiça|🧰 caixa de ferramentas|🔧 chave inglesa|🔨 martelo|⚒️ martelo picareta|🛠️ ferramentas|⛏️ picareta|🔩 parafuso|⚙️ engrenagem configurações|🧱 tijolo|⛓️ correntes|🧲 ímã|🔫 pistola água|💣 bomba|🔪 faca|🗡️ adaga|⚔️ espadas|🛡️ escudo segurança|🔮 bola de cristal|🧿 olho grego|📿 terço|💈 barbearia|⚗️ alambique química|🔭 telescópio|🔬 microscópio ciência|🕳️ buraco|💊 pílula remédio|💉 seringa vacina|🩺 estetoscópio|🧬 dna|🦠 micróbio|🧪 tubo de ensaio|🌡️ termômetro|🧹 vassoura limpeza|🧺 cesto|🧻 papel higiênico|🚽 vaso sanitário|🚿 chuveiro|🛁 banheira|🧼 sabonete|🪥 escova de dentes|🧽 esponja|🛎️ campainha|🔑 chave|🗝️ chave antiga|🚪 porta|🪑 cadeira|🛋️ sofá|🛏️ cama|🧸 urso pelúcia|🖼️ quadro moldura|🛍️ sacolas compras|🛒 carrinho de compras|🎁 presente|🎈 balão|✉️ envelope carta|📧 e-mail|📨 envelope chegando|📩 envelope seta|📤 caixa de saída|📥 caixa de entrada|📦 pacote caixa|🏷️ etiqueta|📪 caixa de correio|📬 correio|📮 caixa postal|📜 pergaminho|📃 página curvada|📄 documento página|📑 abas marcadores|🧾 recibo|📊 gráfico barras|📈 gráfico subindo crescimento|📉 gráfico descendo|🗒️ bloco de notas|🗓️ calendário espiral|📆 calendário|📅 data calendário|🗑️ lixeira|📇 fichário|🗃️ arquivo caixa|🗳️ urna|🗄️ arquivo gaveta|📋 prancheta|📁 pasta|📂 pasta aberta|🗂️ divisórias|🗞️ jornal|📰 jornal notícias|📓 caderno|📔 caderno decorado|📒 livro-razão|📕 livro vermelho|📗 livro verde|📘 livro azul|📙 livro laranja|📚 livros estudo|📖 livro aberto leitura|🔖 marcador|🔗 link corrente|📎 clipe|🖇️ clipes|📐 esquadro|📏 régua|🧮 ábaco|📌 tacha alfinete|📍 alfinete local|✂️ tesoura|🖊️ caneta|🖋️ caneta tinteiro|✒️ pena|🖌️ pincel|🖍️ giz de cera|📝 memorando anotação nota|✏️ lápis|🔍 lupa busca|🔎 lupa direita|🔏 cadeado caneta|🔐 cadeado chave|🔒 cadeado fechado|🔓 cadeado aberto`,
  ],
  [
    'simbolos',
    'Símbolos',
    `✅ marcado concluído feito|☑️ caixa marcada|✔️ visto|❌ x errado|❎ x quadrado|➕ mais|➖ menos|➗ divisão|✖️ multiplicação|♾️ infinito|‼️ exclamação dupla|⁉️ exclamação interrogação|❓ interrogação pergunta|❔ interrogação branca|❗ exclamação importante|❕ exclamação branca|⚠️ aviso atenção|🚸 crianças|⛔ proibido entrada|🚫 proibido|📛 crachá|🔰 iniciante|♻️ reciclagem|✳️ asterisco|❇️ brilho|🔱 tridente|〽️ alternância|©️ copyright|®️ registrado|™️ marca|#️⃣ hashtag|*️⃣ asterisco tecla|0️⃣ zero|1️⃣ um|2️⃣ dois|3️⃣ três|4️⃣ quatro|5️⃣ cinco|6️⃣ seis|7️⃣ sete|8️⃣ oito|9️⃣ nove|🔟 dez|🔠 maiúsculas|🔡 minúsculas|🔢 números|🔣 símbolos|🔤 abc|🅰️ a|🆎 ab|🅱️ b|🆑 cl|🆒 cool legal|🆓 grátis|ℹ️ informação|🆔 id|Ⓜ️ m|🆕 novo|🆖 ng|🅾️ o|🆗 ok|🅿️ estacionamento|🆘 sos socorro|🆙 up|🆚 versus|🔴 círculo vermelho|🟠 círculo laranja|🟡 círculo amarelo|🟢 círculo verde|🔵 círculo azul|🟣 círculo roxo|🟤 círculo marrom|⚫ círculo preto|⚪ círculo branco|🟥 quadrado vermelho|🟧 quadrado laranja|🟨 quadrado amarelo|🟩 quadrado verde|🟦 quadrado azul|🟪 quadrado roxo|🟫 quadrado marrom|⬛ quadrado preto|⬜ quadrado branco|🔶 losango laranja|🔷 losango azul|🔸 losango laranja pequeno|🔹 losango azul pequeno|🔺 triângulo vermelho|🔻 triângulo para baixo|💠 losango flor|🔘 botão rádio|🔳 botão quadrado|🔲 botão preto|🏁 bandeira quadriculada chegada|🚩 bandeira vermelha|🎌 bandeiras cruzadas|🏴 bandeira preta|🏳️ bandeira branca|🏳️‍🌈 bandeira arco-íris|🇧🇷 brasil bandeira|🇵🇹 portugal bandeira|⬆️ seta cima|↗️ seta nordeste|➡️ seta direita|↘️ seta sudeste|⬇️ seta baixo|↙️ seta sudoeste|⬅️ seta esquerda|↖️ seta noroeste|↕️ seta vertical|↔️ seta horizontal|↩️ voltar seta|↪️ seta curva|🔄 atualizar ciclo|🔃 recarregar|🔀 aleatório embaralhar|🔁 repetir|🔂 repetir uma|▶️ play reproduzir|⏸️ pausa|⏹️ parar|⏺️ gravar|⏭️ próximo|⏮️ anterior|⏩ avançar|⏪ retroceder|🔼 cima|🔽 baixo|🔈 som baixo|🔉 som|🔊 som alto|🔇 mudo|🔔 sino notificação|🔕 sem notificação|📣 megafone|📢 alto-falante anúncio|💲 cifrão|💱 câmbio|☮️ paz|✝️ cruz|☯️ yin yang|☪️ lua estrela|🕉️ om|♈ áries|♉ touro|♊ gêmeos|♋ câncer|♌ leão|♍ virgem|♎ libra|♏ escorpião|♐ sagitário|♑ capricórnio|♒ aquário|♓ peixes|⚛️ átomo|☢️ radioativo|☣️ risco biológico|📴 celular desligado|📳 vibrar|🈶 japonês|🉐 pechincha|㊙️ segredo|㊗️ parabéns|🆚 vs|💮 flor branca|🉑 aceitável|♠️ espadas|♥️ copas|♦️ ouros|♣️ paus|🃏 coringa|🀄 mahjong|🎴 cartas flores|🕐 uma hora|🕑 duas horas|🕒 três horas|🕓 quatro horas|🕔 cinco horas|🕕 seis horas`,
  ],
]

export const EMOJI_CATEGORIES: EmojiCategory[] = raw.map(([id, label, list]) => ({ id, label, items: parse(list) }))

export const ALL_EMOJIS: EmojiItem[] = EMOJI_CATEGORIES.flatMap((c) => c.items)

/** Emojis "bonitos" usados para "Adicionar ícone" / "Aleatório". */
const NICE =
  '📝 📒 📓 📔 📕 📗 📘 📙 📚 📖 🗂️ 📁 📌 📎 💡 🎯 🚀 ✨ 🌟 ⭐ 🔥 🌈 🌱 🌿 🍀 🌻 🌸 🌊 🏔️ 🧭 🗺️ 🎨 🎬 🎧 🎸 🎮 🧩 🏆 🎁 🎉 💎 🔮 🧠 💼 📊 📈 🗓️ ✅ ☕ 🍵 🍎 🍋 🥑 🐶 🐱 🦊 🐼 🦉 🐢 🦋 🐙 🌙 ☀️ 🏠 🏝️ ✈️ 🛠️ ⚙️ 🔑 🧪 🔬 🪴 🍄 🌵'.split(' ')

export function randomEmoji(): string {
  return NICE[Math.floor(Math.random() * NICE.length)]
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function searchEmojis(query: string): EmojiItem[] {
  const q = normalize(query.trim())
  if (!q) return ALL_EMOJIS
  const seen = new Set<string>()
  return ALL_EMOJIS.filter((e) => {
    if (seen.has(e.emoji)) return false
    const words = normalize(`${e.keywords} ${e.english ?? ''} ${ENGLISH_ALIASES[e.emoji] ?? ''}`)
    const ok = e.emoji.includes(query.trim()) || words.includes(q)
    if (ok) seen.add(e.emoji)
    return ok
  })
}

const ENGLISH_ALIASES: Record<string,string> = {
 '😀':'smile happy grin', '😃':'smile happy joy', '😄':'smile happy joy', '😁':'smile happy grin', '😆':'laugh happy', '😂':'laugh funny tears', '🤣':'laugh funny',
 '🥰':'love happy', '😍':'love heart', '😢':'sad crying', '😭':'sad crying', '😡':'angry mad', '😠':'angry mad', '😴':'sleep tired', '🥳':'party celebrate',
 '👤':'user profile person', '👥':'users people group team', '🧑‍💻':'developer programmer coder software', '🧑‍🏫':'teacher', '🧑‍🎓':'student', '🧑‍🔬':'scientist', '🧑‍🚀':'astronaut', '🧑‍⚕️':'doctor health',
 '💻':'laptop computer', '🖥️':'desktop computer', '📝':'note memo write document', '📄':'document paper page', '📃':'document paper page', '📒':'notebook journal', '📓':'notebook journal', '📔':'notebook journal',
 '📁':'folder directory', '🗂️':'files folders index', '📊':'chart graph dashboard', '📈':'chart graph growth', '📅':'calendar date', '🗓️':'calendar date', '🎯':'target goal', '✅':'done completed check',
 '🔍':'search find', '🔎':'search find', '💡':'idea light bulb', '⚙️':'settings gear', '🔧':'tools wrench', '🚗':'car automobile', '✈️':'plane flight travel', '🐶':'dog puppy', '🐱':'cat kitten',
 '🇧🇷':'brazil brazilian flag', '🇵🇹':'portugal portuguese flag', '👍':'thumbs up like yes', '👎':'thumbs down dislike no', '🤝':'handshake agreement', '🙏':'please thanks prayer', '🚀':'rocket launch', '🤖':'robot ai',
}
