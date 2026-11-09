# Pokémon Go for People — review instructions

A conference game: find the attendee you match best, where rare shared interests count most. Node 22, no framework (`app/server.js`), Elasticsearch through `app/elastic.js`, deployed to Kubernetes by Argo CD from `deploy/`.

## Matching (the product core)
- Score = sum of shared interests weighted by rarity (BM25 / IDF). Do not add flat "+1 per shared tag" scoring: common interests like Kubernetes must give ~0 points.
- Semantic (Jina) search runs only on free words, never on all tags joined together, and must keep a `min_score` floor. Without the floor, junk input returns fake matches.
- A meaning-only match is worth less than a real shared tag and must not reach "legendary".

## Load and safety
- The "Keynote ends" load must stay bounded: one run at a time, a time limit, a request cap and a concurrency cap. Flag any change that removes a bound.
- Load bots must call the Service (`KEYNOTE_TARGET`), not `127.0.0.1`, so every replica shares the load.
- Elastic calls on the `/api/match` hot path: flag any new sequential call per request. Cache crowd-wide stats instead.

## Privacy and inclusion
- Never expose a player's exact position. The API returns zones and hot/warm/cold only.
- Clues are about topics, never about looks.
- Bot players are simulated data; keep them labelled as bots in the UI.

## Secrets
- The repo is public. Flag any API key, token, kubeconfig or `.env` content in code, manifests or logs.
