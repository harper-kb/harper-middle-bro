# Note summary provider

Step Bro generates Producer and Service Note summaries through a server-only
Harper gateway boundary. No provider credential is exposed to browser code.

Configure these server environment variables:

- `HARPER_NOTE_SUMMARY_URL` — approved HTTPS gateway endpoint.
- `HARPER_NOTE_SUMMARY_TOKEN` — bearer token for that gateway.
- `HARPER_NOTE_SUMMARY_MODEL` — approved model identifier.

If any value is absent, original note threads remain available and the UI shows
an explicitly labeled deterministic **Note overview** made from exact excerpts
of the newest visible notes. It is never presented as AI-generated.

## Request contract

Step Bro sends JSON containing:

- `model`
- `purpose` (`note_thread_chunk` or `note_thread_synthesis`)
- `temperature`
- `max_output_tokens`
- `system`
- `input`, containing only note reference, timestamp, author, and note text

The gateway may return either:

- `{ "summary": "..." }`
- `{ "output_text": "..." }`
- an OpenAI-compatible `choices[0].message.content`

The gateway must not expose tools or actions to this model. It should apply the
approved Harper retention, data-use, and regional-processing policy.

Step Bro applies a 12-second timeout, one bounded retry for transient failures,
hierarchical summarization for long threads, version-keyed in-memory caching,
and in-flight request deduplication. Logs contain operational metadata only;
note bodies, prompts, generated summaries, and credentials are not logged.
