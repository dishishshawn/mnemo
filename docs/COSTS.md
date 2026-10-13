# What Mnemo costs to run

Short answer: **$0 on a free Gemini key, or about $1.50–9 a month with billing enabled for one
student studying every day** (roughly double that from January 2027, when Google's Flash prices go up). Hosting is free (GitHub Pages). For comparison, Thea+ is listed at
$12/month or $48/year in the App Store.

The app shows real spending under **Settings → API spending**, computed from the token counts
Gemini returns on every call. The numbers below are the estimate behind those defaults.

## Measured (live run, 2026-10-13)

`just smoke` runs every feature once against the real API on a ~4.3k-token lecture text
(Wikipedia's "Cellular respiration"). At the default "low" thinking level, Gemini 3.8 Flash used
**0 thinking tokens** on every call, and its implicit cache served ~2k tokens on repeat calls.

| Call                              | Tokens in / out        | Cost      |
| --------------------------------- | ---------------------- | --------- |
| Map concepts                      | 3.8k (2k cached) / 0.5k | $0.0033  |
| 24 flashcards                     | 3.9k / 1.8k            | $0.0098   |
| 8 Smart Study questions           | 4.0k / 1.6k            | $0.0091   |
| Grade a short answer (Flash-Lite) | 0.4k / 0.1k            | $0.0003   |
| 15-question practice test         | 4.1k / 3.4k            | $0.0156   |
| Study guide (20k chars)           | 4.0k / 5.1k            | $0.0222   |
| Summary                           | 3.9k / 1.2k            | $0.0073   |
| Tutor message                     | 4.0k / 0.1k            | $0.0034   |
| Podcast script                    | 3.9k / 2.7k            | $0.0118   |
| Podcast audio, 9.3 min            | 1.7k / 13.9k audio     | $0.0854   |
| **Everything once**               | 16 calls               | **$0.17** (2027: $0.34) |

Output dominates, so a bigger kit mostly raises input cost: a 15k-token kit adds about $0.008
per call at current prices.

## Prices used (paid tier, per 1M tokens, checked 2026-10-13)

| Model                          | Used for                                                           | Input                          | Output                                       |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------ | -------------------------------------------- |
| `gemini-3.8-flash` (thinking: low) | Concepts, flashcards, questions, guides, podcast scripts, tutor | $0.75 → **$1.50 from 2027-01-01** | $3.75 → **$7.50**                             |
| `gemini-3.1-flash-lite`        | Transcribing audio/video, web pages, grading answers               | $0.25 (audio $0.50)            | $1.50                                        |
| `gemini-3.8-flash-lite-tts`    | Podcast voices                                                     | $0.50 → $1.00                  | $6.00 → $12.00 audio (25 tokens/s, ≈$0.009/min) |

Cached input (Gemini's automatic implicit cache) is billed at 10%. Mnemo puts the course material
first in every prompt so repeat calls on the same kit can hit it, but the estimates below assume
no cache hits, so real bills should come in lower.

Source: <https://ai.google.dev/gemini-api/docs/pricing>

## Per feature

Assumes a kit with ~15k tokens of material (a 40-slide lecture plus notes, or a textbook chapter).
These estimates assume ~1k thinking tokens per call; the live run measured 0, so they run high.

| Action                                    | Approx. tokens (in / out)    | Cost now | From 2027 |
| ----------------------------------------- | ---------------------------- | -------- | --------- |
| Build a kit (map concepts + 24 flashcards) | 31k / 5k                    | $0.04    | $0.09     |
| Smart Study, per question (generated 8 at a time) | 2k / 0.5k               | $0.003   | $0.007    |
| Grade one short answer                    | 0.6k / 0.2k (Flash-Lite)     | $0.0005  | $0.0005   |
| Practice test, 15 questions               | 16k / 6.5k                   | $0.04    | $0.08     |
| Study guide                               | 15k / 6k                     | $0.03    | $0.07     |
| Summary                                   | 15k / 2k                     | $0.02    | $0.04     |
| Podcast, 8 minutes (script + audio)       | 18k / 3.5k + 12k audio       | $0.10    | $0.20     |
| Tutor message                             | 16k / 0.8k                   | $0.015   | $0.03     |
| Read a scanned/handwritten PDF, 30 pages  | 8k / 15k                     | $0.06    | $0.12     |
| Text PDF, Word, PowerPoint, pasted notes  | read locally in the browser  | free     | free      |
| 1-hour lecture video or YouTube (low res) | 360k / 15k (Flash-Lite)      | $0.11    | $0.11     |
| 1-hour audio recording                    | 115k / 15k (Flash-Lite)      | $0.08    | $0.08     |

## Per month

| Usage                                                                                                  | Now     | From 2027 |
| ------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **Light**: 6 kits, 15 Smart Study questions/day, 2 tests, 3 guides, 2 podcasts                         | ~$1.50  | ~$3       |
| **Heavy**: 15 kits, 60 questions/day, 8 tests, 15 guides + summaries, 8 podcasts, 8 h of lecture video, 150 tutor messages | ~$9     | ~$17      |

Recomputed with the measured token counts (15k-token kits, no thinking). In the heavy month, Smart Study is the
biggest line (~$4) and tutor chat is next (~$1.70). That's
also why Thea caps free daily questions. Cache hits on the material typically shave 20–30% off.

## Free tier

A free key from <https://aistudio.google.com/apikey> covers one student comfortably, but:

- **Daily request limits** apply. Mnemo makes about one request per 8 Smart Study questions, so
  limits are rarely hit outside of bulk video transcription.
- **Google may use free-tier inputs and outputs to improve its products.** With billing enabled,
  it doesn't.

## Ways to cut cost further

- Settings → Models: set "Study content" to `gemini-3.1-flash-lite` (~3–5x cheaper, somewhat
  weaker questions).
- Upload slides as PDF or PPTX rather than recording a video of them: local text extraction is
  free.
- Shorter podcasts. Audio is the most expensive output per minute of study.
