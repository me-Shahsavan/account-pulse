# Account Pulse

Ask "how is my relationship with {contact} doing?" and get a grounded answer:
a summary built from real email threads, open action items, and meeting slots
proposed from real calendar availability — powered by Nylas v3 primitives with
an LLM agent layer that I own on my side of the line.

🎥 **2-minute demo:** _[link — TODO: record and add]_

## Why I built this

<!-- TODO: rewrite these two paragraphs in your own words before publishing -->
Modern app workflows are becoming agent workflows, and agents are only as good
as their access to real communication state. Email and calendar are where most
working relationships actually live, and Nylas exposes them as clean,
provider-agnostic primitives: auth, messages, threads, availability, send.

I wanted to feel that boundary hands-on rather than read about it: Nylas owns
the communication primitives; I own the intelligence layer (prompts, tool
design, grounding, and the decision about what an agent may and may not do).

## What it does

- Connect a Google/Microsoft test account via **Nylas Hosted Auth** (one grant, stored locally)
- `pulse <email>`: a Claude agent (tool use) pulls real **threads** and **availability** through Nylas
- Produces: relationship summary, last touch, open action items, 2–3 proposed slots from the real calendar
- Drafts a short follow-up email
- **Only after explicit confirmation** (CLI prompt or web button) is the draft sent via the Nylas send API, returning a real message id

## Architecture

```
Hosted Auth ──► grant_id (local JSON store)
                    │
CLI / web form ──► Claude agent (tool use, claude-sonnet-4-6)
                    ├─ search_threads   ─► GET /v3/grants/{id}/threads?any_email=…
                    ├─ get_thread       ─► GET /v3/grants/{id}/messages?thread_id=…
                    ├─ get_availability ─► POST /v3/calendars/availability
                    └─ draft_followup   ─► pure LLM (records the draft)
                    │
human confirms ──► POST /v3/grants/{id}/messages/send  ─► message id
```

Design decision worth noting: the agent can read and draft, but **cannot
send**. There is no send tool in its tool surface; sending is app code behind
an explicit confirmation. An agent that composes email should propose — a
human should dispose.

## Running it

```bash
git clone <this repo> && cd account-pulse
npm install
cp .env.example .env   # fill in NYLAS_API_KEY, NYLAS_CLIENT_ID, ANTHROPIC_API_KEY
```

Nylas setup (sandbox): create a v3 app in the [Nylas dashboard](https://dashboard-v3.nylas.com),
add `http://localhost:3000/auth/callback` as a callback URI, and grab the API
key + client id.

```bash
npm run dev                        # start the server
# visit http://localhost:3000/auth and connect a test account

npm run pulse -- someone@example.com          # agent pulse (review only)
npm run pulse -- someone@example.com --raw    # raw threads + availability, no LLM
npm run pulse -- someone@example.com --send   # pulse, then confirm-to-send
npm test                                      # unit tests (mocked HTTP)
```

## DX notes from building this

> ⚠️ TODO: fill this in yourself from NOTES.md after actually running against
> the sandbox — this section must be true, first-hand observations (auth
> friction, doc gaps or wins, param naming, pagination behavior, error
> messages). Do not ship it generated.

One choice worth explaining now: this repo talks to the v3 REST API with a
small hand-rolled `fetch` wrapper instead of the official Node SDK. For a
prototype whose whole point is understanding the API contract — query params,
`page_token`/`next_cursor` pagination, the `{request_id, data}` envelope, and
error shapes — keeping the HTTP visible was more instructive than hiding it
behind an SDK. In a production app I would reach for the SDK.

## What I'd explore next

- Webhooks (`message.created`) to suggest a pulse refresh when a tracked contact writes back
- Creating a calendar event (with the contact as participant) once a proposed slot is accepted
- Multi-contact "portfolio" view ranking relationships by staleness
