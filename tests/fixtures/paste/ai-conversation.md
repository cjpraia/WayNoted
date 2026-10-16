Você: Quais são as diferenças entre SQLite e PostgreSQL para um app local?

Assistente: Ótima pergunta! Aqui vai um resumo direto.

## Visão geral

**SQLite** é embutido; **PostgreSQL** roda como servidor. Para um app *local-first*, o SQLite costuma bastar.

### Comparação

| Critério | SQLite | PostgreSQL |
|:---------|:------:|-----------:|
| Instalação | nenhuma | servidor |
| Concorrência | `WAL` limitada | **alta** |
| Tamanho | ~1 MB | ~50 MB |

### Quando usar cada um

1. **SQLite** se:
   - o app roda em um único dispositivo
   - você quer zero configuração
2. **PostgreSQL** se:
   - há vários usuários simultâneos
   - precisa de extensões como `pgvector`

> [!tip] Dica
> Comece com SQLite e migre só se precisar.

Exemplo de conexão em Python:

```python
import sqlite3

conn = sqlite3.connect("notas.db")
conn.execute("CREATE TABLE IF NOT EXISTS notas (id INTEGER PRIMARY KEY, texto TEXT)")
```

E em TypeScript:

```ts
import Database from 'better-sqlite3'
const db = new Database('notas.db')
```

- [x] Escolher o banco
- [ ] Escrever as migrações

Veja a [documentação oficial](https://sqlite.org/docs.html) para detalhes.

Você: Obrigado!

Assistente: De nada 🙂
