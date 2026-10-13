# Mnemo

A personal AI study app. Drop in course material (slides, PDFs, photos of notes, lecture
recordings, YouTube links) and Mnemo turns it into a study kit:

- **Smart Study**: adaptive multiple-choice and true/false questions that target your weakest
  concepts and get harder as you improve. When you get one wrong, it nudges you with a hint before
  showing the answer. You can steer it ("focus on chapter 3", "harder questions").
- **Short answers**: the same adaptive engine, but written answers graded by AI, in their own
  section so they don't interrupt a quick multiple-choice session.
- **Flashcards** with FSRS spaced repetition, plus editing and AI top-ups.
- **Practice tests**: exam-style, optionally timed, with short answers graded by AI.
- **Study guides and summaries** you can print to PDF or download as Markdown.
- **Podcasts**: two hosts talk through your material, generated with Gemini TTS.
- **Games**: Definition Match, Term Builder and Stacker, built from your flashcards.
- **Explain it back**: teach a concept out loud from memory (your keyboard's dictation, so it's
  free). Mnemo checks it against the material and lists what you covered, skipped, or got wrong.
- **Tutor**: chat about the material, Socratic by default.
- **Exam date and daily quota**: set the exam date and Mnemo works out, from the spaced-repetition
  state of every concept, how many questions a day keep you above 90% recall on exam day. The
  kit shows today's quota and whether you're on pace; Progress shows the forgetting curve from
  today to the exam and the concepts most at risk. All computed on the device, no API calls.
- **Progress**: mastery per concept, streaks, test history.
- **Sync** across phone, tablet and laptop with a sync code, end-to-end encrypted.
- Any of 60+ languages per kit, folders, light/dark mode, installable as a phone app (PWA).

**Live at <https://mnemo-iota.vercel.app>.** No accounts. The app runs in the browser, keeps
everything in IndexedDB, and calls the Gemini API directly with your own key. The only server
piece is a tiny sync endpoint that stores encrypted blobs it can't read.

> Inspired by [Thea](https://www.theastudy.com/). Not affiliated with it, and none of its code or
> assets are used.

## Using it

1. Open the site, go to **Settings**, and paste a Gemini API key from
   <https://aistudio.google.com/apikey>.
2. **New kit** → add material → **Build study kit**.

**More than one device:** on the first one, **Settings → Sync across devices → Turn on sync**,
then copy the sync code. On each other device, open the site (on iPhone/iPad: Share → Add to Home
Screen first, then open it from there), go to **Settings → I have a sync code**, and paste it.
The API key comes along, so there's nothing else to set up.

How sync works: the code never leaves the device. A vault id and an AES-256-GCM key are derived
from it (HKDF); the device uploads a gzipped, encrypted snapshot to `/api/sync`, which keeps it in
private Vercel Blob storage. Every local change is stamped, merges keep the newest version of each
item, deletions travel as tombstones, and uploads are compare-and-swap on the blob's ETag, so two
devices saving at once can't overwrite each other. Podcast audio isn't synced (too big); other
devices can record their own copy from the synced script.

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
| `src/lib/plan.ts`        | Exam-date planning: daily quota, exam-day forecast     |
| `src/lib/pricing.ts`     | Price table and per-call cost                          |
| `src/lib/sync.ts`        | Change tracking, merge, and the sync loop              |
| `src/lib/crypto.ts`      | Sync code, key derivation, encryption                  |
| `api/sync.ts`            | The sync endpoint (Vercel Function + Blob)             |
| `src/pages/`             | One file per screen                                    |

## Future additions

Ideas that fit the "learning data, not more API calls" direction, in rough order:

- **Confidence calibration.** Occasionally (never every question: only on concepts that look
  strong, at most one in five, never twice on a concept in a session) ask "how sure are you?"
  before revealing the answer. Plot stated confidence against actual accuracy and surface the
  concepts she is confidently wrong about.
- **Study reminders.** A browser can't schedule a notification for tomorrow on its own, so this
  needs Web Push: the device would store its push subscription, a nudge time and a pre-written
  one-line message ("12 due, exam in 9 days") next to its encrypted blob, and a daily cron would
  forward it. The plan itself stays on the device. A calendar export (`.ics` with alarms) of the
  daily quota is the zero-server alternative.
- **Fatigue detection.** Accuracy and hint use over the minutes of a session, against her own
  baseline, with a "you're past your peak, stop here" nudge. Time-of-day accuracy across sessions.
- **Honest streaks.** Count a day only when the due reviews got done, with one freeze a week.
- **Error-driven cram sheet.** The night before, a one-pager built only from the concepts with
  the lowest predicted exam-day recall.
- **"Why this question".** One line under each Smart Study question: due for review, weak, or
  new material being interleaved.

## Development

Needs Node 24. Tasks are in the `justfile`:

```sh
just install   # npm ci
just dev       # http://localhost:5173
just test      # unit tests
just build     # typecheck + production build
just smoke     # live run of every feature against Gemini; needs GEMINI_API_KEY in .env
```

`node scripts/e2e.mjs <url>` drives every screen in headless Chromium with Gemini mocked,
including two browser profiles pairing through sync (`npx playwright install chromium` once;
`E2E_REAL_SYNC=1` uses the real `/api/sync`). `node scripts/real-study.mjs <url> <pdf>...` runs a
real Smart Study session with real Gemini and dumps the questions and costs to `scratch/real/`.

Hosted on Vercel (connected to this repo: every push to `main` deploys). Sync needs a private
Vercel Blob store connected to the project; `npx vercel storage create <name> --type blob
--access private` and `npx vercel storage connect <name>` set that up. GitHub Actions runs the
tests and build on each push.
