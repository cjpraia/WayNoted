// Catálogo das funções de fórmula: alimenta o autocompletar, a documentação inline do editor e os
// testes (cada exemplo é avaliado e comparado ao resultado esperado, com "agora" fixo em
// 2026-10-07 14:30 local).

export type FormulaCategory = 'logic' | 'number' | 'text' | 'date' | 'list' | 'page' | 'style'

export interface FormulaFunctionDoc {
  /** Nome como aparece na documentação (a chamada não diferencia maiúsculas). */
  name: string
  category: FormulaCategory
  signature: string
  pt: string
  en: string
  example: string
  /** Texto do resultado esperado (formulaText); ausente quando depende de dados da linha. */
  result?: string
}

export const FORMULA_CATEGORY_LABELS: Record<FormulaCategory, [string, string]> = {
  logic: ['Lógica', 'Logic'], number: ['Números', 'Numbers'], text: ['Texto', 'Text'], date: ['Datas', 'Dates'],
  list: ['Listas', 'Lists'], page: ['Páginas e propriedades', 'Pages and properties'], style: ['Estilo', 'Style'],
}

const f = (name: string, category: FormulaCategory, signature: string, pt: string, en: string, example: string, result?: string): FormulaFunctionDoc => ({ name, category, signature, pt, en, example, result })

export const FORMULA_FUNCTIONS: FormulaFunctionDoc[] = [
  // Páginas e propriedades
  f('prop', 'page', 'prop("Nome")', 'Valor de uma propriedade desta página. Em páginas relacionadas: current.prop("Nome").', 'Value of a property on this page. On related pages: current.prop("Name").', 'prop("Preço") * 2'),
  f('id', 'page', 'id() · id(página)', 'ID da página atual ou da página informada.', 'ID of the current page or of the given page.', 'id()'),
  f('title', 'page', 'title(página)', 'Título de uma página relacionada.', 'Title of a related page.', 'prop("Tarefas").map(title(current))'),
  // Lógica
  f('if', 'logic', 'if(condição, então, senão)', 'Retorna “então” se a condição for verdadeira; senão, “senão”. Também existe a forma condição ? a : b.', 'Returns “then” when the condition is true, otherwise “else”. Also available as condition ? a : b.', 'if(3 > 2, "sim", "não")', 'sim'),
  f('ifs', 'logic', 'ifs(c1, v1, c2, v2, …, senão)', 'Testa várias condições em ordem e retorna o valor da primeira verdadeira.', 'Tests several conditions in order and returns the value of the first true one.', 'ifs(1 > 2, "a", 2 > 1, "b", "c")', 'b'),
  f('and', 'logic', 'and(a, b, …) · a and b', 'Verdadeiro se todos forem verdadeiros (avaliação curta).', 'True when all values are true (short-circuit).', 'and(true, 1 > 0)', 'true'),
  f('or', 'logic', 'or(a, b, …) · a or b', 'Verdadeiro se algum for verdadeiro (avaliação curta).', 'True when any value is true (short-circuit).', 'or(false, 1 > 0)', 'true'),
  f('not', 'logic', 'not(valor) · !valor', 'Inverte um valor lógico.', 'Negates a boolean.', 'not(true)', 'false'),
  f('empty', 'logic', 'empty(valor)', 'Verdadeiro para vazio, texto vazio ou lista vazia.', 'True for empty values, empty text or an empty list.', 'empty("")', 'true'),
  f('equal', 'logic', 'equal(a, b) · a == b', 'Compara dois valores.', 'Compares two values.', 'equal(2, 1 + 1)', 'true'),
  f('unequal', 'logic', 'unequal(a, b) · a != b', 'Verdadeiro se os valores forem diferentes.', 'True when values differ.', 'unequal("a", "b")', 'true'),
  f('coalesce', 'logic', 'coalesce(a, b, …)', 'Primeiro valor não vazio.', 'First non-empty value.', 'coalesce("", "padrão")', 'padrão'),
  f('let', 'logic', 'let(nome, valor, expressão)', 'Define uma variável local para a expressão.', 'Defines a local variable for the expression.', 'let(x, 5, x * 2)', '10'),
  f('lets', 'logic', 'lets(n1, v1, n2, v2, …, expressão)', 'Define várias variáveis; cada uma pode usar as anteriores.', 'Defines several variables; each one may use the previous ones.', 'lets(a, 2, b, a + 3, a * b)', '10'),
  // Números
  f('add', 'number', 'add(a, b) · a + b', 'Soma (ou concatena texto).', 'Adds (or concatenates text).', 'add(2, 3)', '5'),
  f('subtract', 'number', 'subtract(a, b) · a - b', 'Subtração.', 'Subtraction.', 'subtract(10, 4)', '6'),
  f('multiply', 'number', 'multiply(a, b) · a * b', 'Multiplicação.', 'Multiplication.', 'multiply(6, 7)', '42'),
  f('divide', 'number', 'divide(a, b) · a / b', 'Divisão; divisão por zero fica vazia.', 'Division; division by zero is empty.', 'divide(10, 4)', '2.5'),
  f('mod', 'number', 'mod(a, b) · a % b', 'Resto da divisão.', 'Remainder of a division.', 'mod(10, 3)', '1'),
  f('pow', 'number', 'pow(a, b) · a ^ b', 'Potência.', 'Exponentiation.', 'pow(2, 10)', '1024'),
  f('abs', 'number', 'abs(n)', 'Valor absoluto.', 'Absolute value.', 'abs(-4)', '4'),
  f('round', 'number', 'round(n, casas?)', 'Arredonda para o inteiro (ou casas decimais) mais próximo.', 'Rounds to the nearest integer (or decimal places).', 'round(3.14159, 2)', '3.14'),
  f('ceil', 'number', 'ceil(n)', 'Arredonda para cima.', 'Rounds up.', 'ceil(1.2)', '2'),
  f('floor', 'number', 'floor(n)', 'Arredonda para baixo.', 'Rounds down.', 'floor(1.8)', '1'),
  f('trunc', 'number', 'trunc(n)', 'Remove a parte decimal.', 'Removes the decimal part.', 'trunc(-1.8)', '-1'),
  f('sqrt', 'number', 'sqrt(n)', 'Raiz quadrada.', 'Square root.', 'sqrt(16)', '4'),
  f('cbrt', 'number', 'cbrt(n)', 'Raiz cúbica.', 'Cube root.', 'cbrt(27)', '3'),
  f('exp', 'number', 'exp(n)', 'e elevado a n.', 'e raised to n.', 'round(exp(1), 3)', '2.718'),
  f('ln', 'number', 'ln(n)', 'Logaritmo natural.', 'Natural logarithm.', 'round(ln(e()), 2)', '1'),
  f('log10', 'number', 'log10(n)', 'Logaritmo na base 10.', 'Base-10 logarithm.', 'log10(1000)', '3'),
  f('log2', 'number', 'log2(n)', 'Logaritmo na base 2.', 'Base-2 logarithm.', 'log2(8)', '3'),
  f('sign', 'number', 'sign(n)', '-1, 0 ou 1 conforme o sinal.', '-1, 0 or 1 depending on the sign.', 'sign(-12)', '-1'),
  f('pi', 'number', 'pi()', 'A constante π.', 'The π constant.', 'round(pi(), 4)', '3.1416'),
  f('e', 'number', 'e()', 'A constante e.', 'The e constant.', 'round(e(), 4)', '2.7183'),
  f('min', 'number', 'min(a, b, …) · min(lista)', 'Menor número (ou data).', 'Smallest number (or date).', 'min(4, [2, 8])', '2'),
  f('max', 'number', 'max(a, b, …) · max(lista)', 'Maior número (ou data).', 'Largest number (or date).', 'max(4, [2, 8])', '8'),
  f('sum', 'number', 'sum(a, b, …) · sum(lista)', 'Soma de números e listas.', 'Sum of numbers and lists.', 'sum([1, 2, 3], 4)', '10'),
  f('mean', 'number', 'mean(lista) · average(lista)', 'Média aritmética.', 'Arithmetic mean.', 'mean([1, 2, 3, 4])', '2.5'),
  f('average', 'number', 'average(lista)', 'Sinônimo de mean().', 'Alias of mean().', 'average([2, 4])', '3'),
  f('median', 'number', 'median(lista)', 'Mediana.', 'Median.', 'median([5, 1, 3, 2])', '2.5'),
  f('toNumber', 'number', 'toNumber(valor)', 'Converte texto (aceita 1.234,5), datas e lógicos em número.', 'Converts text (accepts 1,234.5), dates and booleans to a number.', 'toNumber("12,5") + 1', '13.5'),
  // Texto
  f('format', 'text', 'format(valor)', 'Converte qualquer valor em texto.', 'Converts any value to text.', 'format(42) + "!"', '42!'),
  f('concat', 'text', 'concat(a, b, …)', 'Junta textos (ou listas).', 'Joins texts (or lists).', 'concat("A", "-", 42)', 'A-42'),
  f('join', 'text', 'join(lista, separador)', 'Junta os itens de uma lista com um separador.', 'Joins list items with a separator.', 'join(["a", "b", "c"], " / ")', 'a / b / c'),
  f('length', 'text', 'length(texto|lista)', 'Número de caracteres ou de itens.', 'Number of characters or items.', 'length("Workspace")', '9'),
  f('lower', 'text', 'lower(texto)', 'Minúsculas.', 'Lowercase.', 'lower("ABC")', 'abc'),
  f('upper', 'text', 'upper(texto)', 'Maiúsculas.', 'Uppercase.', 'upper("abc")', 'ABC'),
  f('capitalize', 'text', 'capitalize(texto)', 'Primeira letra maiúscula.', 'Uppercases the first letter.', 'capitalize("olá")', 'Olá'),
  f('trim', 'text', 'trim(texto)', 'Remove espaços nas pontas.', 'Removes surrounding spaces.', 'trim("  oi  ")', 'oi'),
  f('replace', 'text', 'replace(texto, trecho, novo)', 'Substitui todas as ocorrências literais.', 'Replaces every literal occurrence.', 'replace("a-b-c", "-", "+")', 'a+b+c'),
  f('replaceAll', 'text', 'replaceAll(texto, regex, novo)', 'Substitui todas as correspondências de uma expressão regular.', 'Replaces every regular-expression match.', 'replaceAll("a1b22", "[0-9]+", "#")', 'a#b#'),
  f('replaceFirst', 'text', 'replaceFirst(texto, regex, novo)', 'Substitui a primeira correspondência.', 'Replaces the first match.', 'replaceFirst("a1b2", "[0-9]", "#")', 'a#b2'),
  f('test', 'text', 'test(texto, regex)', 'Verdadeiro se a expressão regular corresponder.', 'True when the regular expression matches.', 'test("pedido-123", "\\\\d+")', 'true'),
  f('match', 'text', 'match(texto, regex)', 'Lista de correspondências.', 'List of matches.', 'match("a1b22", "[0-9]+")', '1, 22'),
  f('split', 'text', 'split(texto, separador)', 'Divide o texto numa lista.', 'Splits text into a list.', 'split("a,b,c", ",")', 'a, b, c'),
  f('repeat', 'text', 'repeat(texto, n)', 'Repete o texto n vezes.', 'Repeats the text n times.', 'repeat("★", 3)', '★★★'),
  f('padStart', 'text', 'padStart(texto, tamanho, preenchimento)', 'Completa à esquerda.', 'Pads on the left.', 'padStart("7", 3, "0")', '007'),
  f('padEnd', 'text', 'padEnd(texto, tamanho, preenchimento)', 'Completa à direita.', 'Pads on the right.', 'padEnd("7", 3, "0")', '700'),
  f('substring', 'text', 'substring(texto, início, fim?)', 'Trecho do texto (índices a partir de 0).', 'Part of the text (0-based indexes).', 'substring("Workspace", 0, 5)', 'Works'),
  f('slice', 'text', 'slice(texto|lista, início, fim?)', 'Trecho de texto ou lista; aceita índices negativos.', 'Part of a text or list; accepts negative indexes.', 'slice([1, 2, 3, 4], 1, -1)', '2, 3'),
  f('startsWith', 'text', 'startsWith(texto, início)', 'Verdadeiro se começar com o trecho.', 'True when the text starts with the value.', 'startsWith("Workspace", "Work")', 'true'),
  f('endsWith', 'text', 'endsWith(texto, fim)', 'Verdadeiro se terminar com o trecho.', 'True when the text ends with the value.', 'endsWith("Workspace", "space")', 'true'),
  f('contains', 'text', 'contains(texto|lista, valor)', 'Verdadeiro se contiver o valor.', 'True when it contains the value.', 'contains(["a", "b"], "b")', 'true'),
  f('includes', 'list', 'includes(lista, valor)', 'Sinônimo de contains().', 'Alias of contains().', 'includes([1, 2], 2)', 'true'),
  f('indexOf', 'list', 'indexOf(texto|lista, valor)', 'Posição do valor (ou -1).', 'Position of the value (or -1).', 'indexOf(["a", "b"], "b")', '1'),
  // Estilo
  f('style', 'style', 'style(valor, "b", "i", "u", "s", "c", "red", "red_background", "#hex")', 'Aplica negrito, itálico, sublinhado, tachado, código e cores na exibição.', 'Applies bold, italic, underline, strikethrough, code and colors when displayed.', 'style("Atrasado", "b", "red")', 'Atrasado'),
  f('unstyle', 'style', 'unstyle(valor, estilos?)', 'Remove estilos (todos ou os informados).', 'Removes styles (all or the given ones).', 'unstyle(style("x", "b"))', 'x'),
  f('link', 'style', 'link(rótulo, url)', 'Texto com link (http, https ou mailto).', 'Text with a link (http, https or mailto).', 'link("Site", "https://example.com")', 'Site'),
  // Listas
  f('list', 'list', 'list(a, b, …) · [a, b]', 'Cria uma lista.', 'Creates a list.', 'list(1, 2, 3)', '1, 2, 3'),
  f('at', 'list', 'at(lista, índice) · lista[índice]', 'Item na posição (negativo conta do fim).', 'Item at the position (negative counts from the end).', 'at([10, 20, 30], -1)', '30'),
  f('first', 'list', 'first(lista)', 'Primeiro item.', 'First item.', 'first(["a", "b"])', 'a'),
  f('last', 'list', 'last(lista)', 'Último item.', 'Last item.', 'last(["a", "b"])', 'b'),
  f('sort', 'list', 'sort(lista, chave?)', 'Ordena (opcionalmente pela expressão com current).', 'Sorts (optionally by an expression using current).', 'sort([3, 1, 2])', '1, 2, 3'),
  f('reverse', 'list', 'reverse(lista)', 'Inverte a ordem.', 'Reverses the order.', 'reverse([1, 2, 3])', '3, 2, 1'),
  f('unique', 'list', 'unique(lista)', 'Remove itens repetidos.', 'Removes repeated items.', 'unique(["a", "b", "a"])', 'a, b'),
  f('flat', 'list', 'flat(lista)', 'Achata listas aninhadas.', 'Flattens nested lists.', 'flat([[1, 2], [3]])', '1, 2, 3'),
  f('map', 'list', 'map(lista, expressão)', 'Transforma cada item; use current (item) e index (posição).', 'Transforms each item; use current (item) and index (position).', '[1, 2, 3].map(current * 10)', '10, 20, 30'),
  f('filter', 'list', 'filter(lista, condição)', 'Mantém os itens que atendem à condição.', 'Keeps the items matching the condition.', '[1, 2, 3, 4].filter(current > 2)', '3, 4'),
  f('find', 'list', 'find(lista, condição)', 'Primeiro item que atende à condição.', 'First item matching the condition.', 'find([5, 8, 12], current > 6)', '8'),
  f('findIndex', 'list', 'findIndex(lista, condição)', 'Posição do primeiro item que atende (ou -1).', 'Position of the first matching item (or -1).', 'findIndex(["a", "b"], current == "b")', '1'),
  f('some', 'list', 'some(lista, condição)', 'Verdadeiro se algum item atender.', 'True when any item matches.', 'some([1, 5], current > 4)', 'true'),
  f('every', 'list', 'every(lista, condição)', 'Verdadeiro se todos atenderem.', 'True when every item matches.', 'every([1, 5], current > 0)', 'true'),
  f('count', 'list', 'count(lista, condição?)', 'Quantidade de itens (que atendem à condição).', 'Number of items (matching the condition).', 'count([1, 5, 9], current > 2)', '2'),
  // Datas
  f('now', 'date', 'now()', 'Data e hora atuais.', 'Current date and time.', 'now()', '2026-10-07 14:30'),
  f('today', 'date', 'today()', 'Data de hoje (sem hora).', 'Today’s date (no time).', 'today()', '2026-10-07'),
  f('minute', 'date', 'minute(data)', 'Minuto (0–59).', 'Minute (0–59).', 'minute(now())', '30'),
  f('hour', 'date', 'hour(data)', 'Hora (0–23).', 'Hour (0–23).', 'hour(now())', '14'),
  f('day', 'date', 'day(data)', 'Dia da semana: 1 (segunda) a 7 (domingo).', 'Day of the week: 1 (Monday) to 7 (Sunday).', 'day(parseDate("2026-10-11"))', '7'),
  f('date', 'date', 'date(data)', 'Dia do mês (1–31).', 'Day of the month (1–31).', 'date(parseDate("2026-10-07"))', '7'),
  f('week', 'date', 'week(data)', 'Semana ISO do ano.', 'ISO week of the year.', 'week(parseDate("2026-01-01"))', '1'),
  f('month', 'date', 'month(data)', 'Mês (1–12).', 'Month (1–12).', 'month(parseDate("2026-10-07"))', '10'),
  f('year', 'date', 'year(data)', 'Ano.', 'Year.', 'year(parseDate("2026-10-07"))', '2026'),
  f('dateAdd', 'date', 'dateAdd(data, n, unidade)', 'Soma tempo: "years", "quarters", "months", "weeks", "days", "hours", "minutes" (ou em português).', 'Adds time: "years", "quarters", "months", "weeks", "days", "hours", "minutes".', 'dateAdd(parseDate("2026-01-31"), 1, "months")', '2026-02-28'),
  f('dateSubtract', 'date', 'dateSubtract(data, n, unidade)', 'Subtrai tempo.', 'Subtracts time.', 'dateSubtract(parseDate("2026-10-07"), 7, "days")', '2026-09-30'),
  f('dateBetween', 'date', 'dateBetween(início, fim, unidade)', 'Tempo de “início” até “fim” na unidade escolhida.', 'Time from “start” to “end” in the chosen unit.', 'dateBetween("2026-10-01", "2026-12-15", "months")', '2'),
  f('dateRange', 'date', 'dateRange(início, fim)', 'Cria um intervalo de datas.', 'Creates a date range.', 'dateRange(parseDate("2026-10-01"), parseDate("2026-10-05"))', '2026-10-01 → 2026-10-05'),
  f('dateStart', 'date', 'dateStart(intervalo)', 'Início de um intervalo.', 'Start of a range.', 'dateStart(dateRange("2026-10-01", "2026-10-05"))', '2026-10-01'),
  f('dateEnd', 'date', 'dateEnd(intervalo)', 'Fim de um intervalo.', 'End of a range.', 'dateEnd(dateRange("2026-10-01", "2026-10-05"))', '2026-10-05'),
  f('timestamp', 'date', 'timestamp(data)', 'Milissegundos desde 1970 (fuso local).', 'Milliseconds since 1970 (local time zone).', 'timestamp(fromTimestamp(1000))', '1000'),
  f('fromTimestamp', 'date', 'fromTimestamp(ms)', 'Data a partir de milissegundos.', 'Date from milliseconds.', 'year(fromTimestamp(0)) >= 1969', 'true'),
  f('formatDate', 'date', 'formatDate(data, "DD/MM/YYYY")', 'Formata com YYYY, YY, MMMM, MMM, MM, M, DD, D, dddd, ddd, HH, hh, mm, ss, A, Q, W e [texto literal].', 'Formats with YYYY, YY, MMMM, MMM, MM, M, DD, D, dddd, ddd, HH, hh, mm, ss, A, Q, W and [literal text].', 'formatDate(parseDate("2026-10-07"), "DD/MM/YYYY")', '07/10/2026'),
  f('parseDate', 'date', 'parseDate("2026-10-07")', 'Converte texto ISO (ou DD/MM/AAAA) em data.', 'Converts ISO text (or DD/MM/YYYY) to a date.', 'parseDate("07/10/2026")', '2026-10-07'),
]

export const FORMULA_KEYWORDS = ['true', 'false', 'null', 'and', 'or', 'not', 'current', 'index']

const BY_NAME = new Map(FORMULA_FUNCTIONS.map((doc) => [doc.name.toLowerCase(), doc]))
export function formulaFunctionDoc(name: string): FormulaFunctionDoc | undefined { return BY_NAME.get(name.toLowerCase()) }
