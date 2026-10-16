# Artificial intelligence

AI is optional. The app works without a provider or API key.

## Setup

Choose a provider and test the connection in **Settings → AI**:

| Provider | Execution | Requirements |
|---|---|---|
| Ollama | Local; defaults to `127.0.0.1:11434` | Service and model installed on this Mac |
| OpenRouter | Cloud | API key, consent, and a selected model |
| Google | Cloud | API key, consent, and a selected model |

Example Ollama setup:

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

The text model handles generation; the embedding model handles semantic search. Keyword retrieval remains available without embeddings. Apple's embedding helper is another local option on compatible macOS versions.

## Usage

The page assistant uses your prompt and selected context. **Ask your notes** retrieves passages locally and returns answers with citations that open the source pages or blocks.

Voice transcription and task extraction use separate paths: system dictation is local; task extraction can use the configured local model. Review the result before creating tasks.

## Privacy

**Block cloud providers** prevents calls to those providers. When cloud access is enabled, consent and preview settings control confirmation before sending. The preview shows the messages to be sent: instructions, prompt, and context.

| Action | Data involved |
|---|---|
| Local Ollama request | Messages sent to the service on this Mac |
| Cloud connection test or model listing | Provider credential, without page content |
| Cloud generation | Previewed messages sent to the selected provider |
| Local index and embeddings | Processing in local Ollama or Apple's helper |

Password-protected pages, even when unlocked, trashed pages, and locked workspaces are excluded from context. **Private to AI** excludes a page and its descendants from agents and cloud AI; the local provider may still use that content.

The app sends no additional telemetry. Optional OpenRouter attribution is configurable. External services have their own data policies.

Keys are handled in the main process and are not exposed to the renderer. Configuration can use protected storage or keep a key only in memory. Keychain access can trigger a macOS prompt; see [Security](SECURITY.md).

## Maintenance

- `electron/ai/`: providers, networking, credentials, consent, and access policies.
- `src/ai/`: retrieval, indexing, citations, and interface state.
- `native/Embedding.swift`: local Apple embeddings.
- `ai-*`, `local-ai-*`, and `secure-storage-ai` tests in `tests/`.

Answers can be wrong. Citations help you review sources but do not replace checking the content.
