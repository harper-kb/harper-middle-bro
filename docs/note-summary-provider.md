# Note summary provider

Step Bro generates Producer and Service Note summaries through a server-only
Harper gateway boundary. No provider credential is exposed to browser code.

Configure these server environment variables:

- `HARPER_NOTE_SUMMARY_URL` — approved HTTPS gateway endpoint.
- `HARPER_NOTE_SUMMARY_TOKEN` — bearer token for that gateway.
- `HARPER_NOTE_SUMMARY_MODEL` — approved model identifier.

Summaries are requested only for threads with at least two authorized visible
notes. Empty threads stay compact; a single visible note is rendered verbatim
with its author. If provider configuration is absent or a multi-note request
fails, original notes and attribution remain available while the card reports
**AI summary unavailable**.

## Request contract

Step Bro sends JSON containing:

- `model`
- `purpose` (`note_thread_chunk` or `note_thread_synthesis`)
- `temperature`
- `max_output_tokens`
- `system`
- `input`, containing only note reference, timestamp, author, and note text

For URLs ending in `/chat/completions`, Step Bro sends the standard
OpenAI-compatible `messages` request. Reasoning models receive low reasoning
effort and an 800-token completion budget so hidden reasoning cannot consume
the complete response before any summary text is emitted. Other endpoints
receive the Harper gateway contract above.

The provider may return either:

- `{ "summary": "..." }`
- `{ "output_text": "..." }`
- an OpenAI-compatible `choices[0].message.content`

The gateway must not expose tools or actions to this model. It should apply the
approved Harper retention, data-use, and regional-processing policy.

Step Bro applies a 12-second timeout, one bounded retry for transient failures,
hierarchical summarization for long threads, version-keyed durable caching
(summaries persist in local SQLite, so each visible thread version costs at
most one generation — including across process restarts), and in-flight
request deduplication. Logs contain operational metadata only; note bodies,
prompts, generated summaries, and credentials are not logged.

The current approved production configuration reuses Harper Tools' Cerebras
credential with `gpt-oss-120b` at
`https://api.cerebras.ai/v1/chat/completions`. Local development should run
through `railway run` so the credential stays in Railway rather than being
copied into browser-visible or committed files.
