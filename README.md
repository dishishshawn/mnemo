# Mnemo

A personal AI study app. Drop in course material (slides, PDFs, photos of notes, lecture
recordings, YouTube links) and Mnemo turns it into a study kit:

- **Smart Study**: adaptive questions that target your weakest concepts and get harder as you
  improve. When you get one wrong, it nudges you with a hint before showing the answer. You can
  steer it ("focus on chapter 3", "harder questions").
- **Flashcards** with FSRS spaced repetition, plus editing and AI top-ups.
- **Practice tests**: exam-style, optionally timed, with short answers graded by AI.
- **Study guides and summaries** you can print to PDF or download as Markdown.
- **Podcasts**: two hosts talk through your material, generated with Gemini TTS.
- **Games**: Definition Match, Term Builder and Stacker, built from your flashcards.
- **Tutor**: chat about the material, Socratic by default.
- **Progress**: mastery per concept, streaks, test history.
- Any of 60+ languages per kit, folders, light/dark mode, installable as a phone app (PWA).

No accounts and no server. The app runs entirely in the browser, keeps everything in IndexedDB,
and calls the Gemini API directly with your own key.

> Inspired by [Thea](https://www.theastudy.com/). Not affiliated with it, and none of its code or
> assets are used.

## Using it

1. Open the site, go to **Settings**, and paste a Gemini API key from
   <https://aistudio.google.com/apikey>.
2. **New kit** → add material → **Build study kit**.

Data stays in the browser it was created in. Use **Settings → Export backup** to move it to
another device or keep a copy.

## Cost

Free on a free-tier Gemini key, or roughly **$1.50–9/month** with billing enabled for daily use
(a live run of every feature once cost $0.17).
**Settings → API spending** tracks actual spend per feature from Gemini's own token counts. The
full breakdown is in [docs/COSTS.md](docs/COSTS.md).

## How it works

```
file / link / notes ──► ingest once ──► Markdown text (IndexedDB)
                         │  PDF, DOCX, PPTX, text: extracted locally (free)
                         │  scans, images, audio, video, YouTube, web: Gemini
                         ▼
                 concept map (5–30 concepts)
                         ▼
   flashcards · questions · guides · podcast · tutor   ◄── every prompt is [material][task]
                         ▼                                  so repeat calls hit Gemini's cache
   FSRS scheduling per card and per concept ──► Smart Study picks due/weak concepts next
```

| Path                     | What                                                   |
| ------------------------ | ------------------------------------------------------ |
| `src/lib/gemini.ts`      | Gemini client: retries, thinking level, cost logging   |
| `src/lib/prompts.ts`     | Every prompt and JSON schema                           |
| `src/lib/ingest.ts`      | Turning sources into text                              |
| `src/lib/study.ts`       | Kit building and each generator                        |
| `src/lib/smart.ts`       | Adaptive question selection and mastery                |
| `src/lib/pricing.ts`     | Price table and per-call cost                          |
| `src/pages/`             | One file per screen                                    |

## Development

Needs Node 24. Tasks are in the `justfile`:

```sh
just install   # npm ci
just dev       # http://localhost:5173
just test      # unit tests
just build     # typecheck + production build
just smoke     # live run of every feature against Gemini; needs GEMINI_API_KEY in .env
```

`node scripts/e2e.mjs <url>` drives every screen in headless Chromium with Gemini mocked
(`npx playwright install chromium` once).

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
