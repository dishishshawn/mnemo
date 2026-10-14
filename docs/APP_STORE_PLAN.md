# App Store launch plan

Written 2026-10-14 for a later session (planned for the week of 2026-10-19). Nothing in here has
been started. Work through it top to bottom, tick boxes as you go, and keep this file current so
the session after you can pick up where you stopped.

## Context for a fresh session

Mnemo is a React + Vite PWA (live at https://mnemo-iota.vercel.app) that turns course material into
study kits with Gemini. The user pastes their own Gemini API key; the only server code is
`api/sync.ts` (encrypted sync blobs in Vercel Blob). Its one real user today is Shawn's girlfriend,
who studies on iPhone, iPad and MacBook. Read `README.md` and `justfile` first.

Shawn wants to sell it on the iOS App Store. Research on 2026-10-14 found that the original idea, a
**$2.99 paid download that needs the user's own key**, should not ship in that form. The full
research, with sources, is on gigapc (not in git):

- `reports/AI study app competitors and pricing.md`
- `reports/AI study app blockers workarounds.md`
- `research_notes/` (raw notes behind both)

If you are on another machine and need them, ask Shawn to copy them over. The facts this plan
depends on are summarised under "Why" at the end, with links.

## The plan in one paragraph

Free download in Education with one non-consumable in-app purchase ("Full version", $2.99 at launch,
$4.99 later). The AI runs on the user's own Gemini key, which the app calls "connecting your Google
AI Studio account", never "unlocking". Rated 18+, with Apple's Declared Age Range API hiding the
Gemini features from under-18s. Launched first outside the EEA, UK and Switzerland. Renamed, because
"Mnemo" is taken. Wrapped with Capacitor 8 (needs Xcode 26 on a Mac) with enough native features to
pass Guideline 4.2.

## Decisions Shawn must confirm before code changes

Ask these; don't assume. The recommendation is in bold.

- [ ] **Name.** Bare "Mnemo" is unusable. Shortlist, all clean on 5 storefronts and in US
      trademarks on 2026-10-14: **Memorook** (memory + rookery, a penguin colony), Recallery,
      Penmemo, Memoglyph. The real test is creating the app record in App Store Connect.
- [ ] **What is free and what the unlock adds.** Recommended: free = manual decks, SRS review,
      imports, exam planner, two bundled demo kits, one trial AI kit on the user's key. Unlock =
      unlimited AI kits, Smart Study generation, short-answer grading, Explain it back, podcasts,
      sync, export.
- [ ] **Price.** **$2.99 launch, $4.99 list** (one-time, never a subscription).
- [ ] **The free web PWA.** It would compete with the paid app. Recommended: keep it as the free
      web-only version, fully unlocked (his girlfriend uses it), and never link to it from the iOS
      app.
- [ ] **Sync backend hosting for a commercial app.** Vercel's Hobby plan is for non-commercial use.
      Check which plan the `mnemo` project is on (`npx vercel` CLI, team dishishshawns-projects).
      Options: upgrade to Pro, or accept the risk until there are sales. Verify the current Hobby
      terms before advising.
- [ ] **Does the Gemini key keep syncing between devices?** Today it rides inside the encrypted
      sync snapshot (`src/lib/sync.ts` snapshots all settings except `LOCAL_ONLY`). It is end-to-end
      encrypted, so keeping it is defensible; the plan below moves it to the Keychain on iOS.
- [ ] **Is this plan file OK in a public repo?** The GitHub repo is public. Commit it only if Shawn
      is fine with that; otherwise keep it local or move it to a private place.

## Phase 1: paperwork (Shawn does these, start on day 1)

These have the longest waits (1 to 3 weeks), so they start before any code.

- [ ] Enroll in the Apple Developer Program as an individual ($99/year). His legal name shows as
      the seller. https://developer.apple.com/programs/enroll/
- [ ] When enrollment is active, create the app record in App Store Connect with the chosen name, to
      claim it. If it's refused, use the next name on the list.
- [ ] Accept the Paid Apps Agreement, submit the W-9 and bank details. Paid apps and in-app purchases
      can't be submitted until these show Active; banking "Processing" has taken 2 days to a month.
- [ ] Join the App Store Small Business Program (15% commission instead of 30%). It is not
      retroactive, so join before the first sale.
- [ ] Get a **paid-tier** Gemini API key with a small budget, for App Review. A free key can hit
      rate limits during review and cause a 2.1 rejection.
- [ ] Decide a support URL and a privacy policy URL (can be pages on the Vercel site).

## Phase 2: web-side changes (any machine, before the iOS shell)

All plain web code. Keep `just test`, `just build` and `node scripts/e2e.mjs` green after each step
(e2e needs `npx vite preview --port 4173` running; see the header of `scripts/e2e.mjs`). The web
PWA must keep working, fully unlocked, throughout.

- [ ] **Build target flag.** Add a build-time target (e.g. `VITE_TARGET=ios` vs web) so the iOS
      build can differ: no service worker, entitlement gate on, absolute sync URL. The web build
      stays as it is today.
- [ ] **Rename the user-facing brand** (header in `src/components/Layout.tsx`, `index.html` title,
      PWA manifest in `vite.config.ts`, copy in `src/pages/Home.tsx` and `NewKit.tsx`, the tutor
      persona in `src/lib/prompts.ts`, the busy-servers message in `src/lib/gemini.ts`, the error
      text in `src/lib/backup.ts`). Use `rg -n Mnemo src index.html vite.config.ts`.
      **Do not rename storage identifiers**: the Dexie database `"mnemo"` (`src/lib/db.ts`), the
      `mnemo.*` localStorage keys (`settings.ts`, `sync.ts`), and the backup format tag
      `app: "mnemo"` (`backup.ts`). Renaming them wipes existing data or breaks old backups.
      Decide with Shawn whether the web PWA is renamed too or stays "Mnemo".
- [ ] **Entitlement gate.** One module (e.g. `src/lib/entitlement.ts`) with `isUnlocked()` and a
      config flag `AI_IN_FREE_TIER`. Off by default (AI behind the unlock); flipping it on gives the
      fallback model (AI free on the user's key, unlock sells sync, export and unlimited saved kits)
      in case App Review objects under 3.1.1 or 5.2.2. On the web build `isUnlocked()` is always true.
      The purchase itself is wired in Phase 3; here, stub it.
- [ ] **Trial kit.** One AI kit allowed before purchase, so buyers can confirm their key works.
- [ ] **Two bundled demo kits.** Pre-generate (questions, flashcards, guide, summary, and a short
      podcast) from two public-domain or self-written sources with the real API (`.env` has a key;
      `just smoke` shows the pattern). Ship them as static JSON plus audio. Watch the bundle size.
- [ ] **Age gate.** Before any Gemini feature: on iOS, ask the Declared Age Range API (bridge comes
      in Phase 3); if under 18, hide Gemini features. If the user declines to share or the API is
      unavailable, ask for an explicit "I am 18 or older" confirmation and remember it.
- [ ] **Consent screen,** once, before the first upload: notes go to the user's own Google account;
      on a free key Google may train on uploads and human reviewers may read them; Google requires
      key holders to be 18+; withdrawable in Settings.
- [ ] **Key screen copy.** "Connect your Google AI Studio account (free key)". Never "unlock" or
      "activate". The link to aistudio.google.com in `src/pages/Settings.tsx` is fine to keep, but
      on iOS open it in an in-app Safari view (Capacitor Browser plugin), not `target="_blank"`.
- [ ] **No other outbound links** in the main flow. Today the AI Studio link above is the only one.
- [ ] **Never mention Thea** anywhere in App Store metadata (Guideline 2.3.7). The README credit is
      fine; inside the app, only on an About screen if at all.
- [ ] **Sync from inside the app.** `src/lib/sync.ts` uses the relative path `/api/sync`; inside
      Capacitor that resolves to the app bundle, not Vercel. The iOS build needs the absolute URL
      (https://mnemo-iota.vercel.app/api/sync, or a renamed domain), and `api/sync.ts` needs CORS
      headers allowing the Capacitor origin (`capacitor://localhost`) including the `If-Match` and
      `X-Etag` headers, plus an `OPTIONS` preflight. Keep the W/ ETag handling (see memory notes).
- [ ] **Delete my sync data** action in Settings (removes the vault blob server-side). Not strictly
      required for a no-account app, but cheap and reviewers like it.
- [ ] **Cost display and default model.** "API spending" already exists. Note that Gemini 3.8 Flash
      doubles in price on 2027-01-01 (`src/lib/pricing.ts`); consider 3.5 Flash-Lite as the default
      for new users.

## Phase 3: iOS shell (on the Mac)

Prerequisites: Xcode 26 (App Store builds must come from Xcode 26 since 2026-04-28), Node 24 (mise),
the repo cloned and Phase 2 merged.

- [ ] Add Capacitor 8 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`), `npx cap init`, then
      `npx cap add ios`. Bundle the built `dist/`; **no remote `server.url`** (a 4.2 red flag).
- [ ] **Turn off the service worker in the iOS build.** `vite-plugin-pwa` registers one, and the
      app is already bundled, so it adds nothing and service workers are unreliable in WKWebView on
      a custom scheme (verify). Skip `VitePWA` when building for iOS.
- [ ] **Check Gemini calls work from the WebView early** (origin `capacitor://localhost`). Run one
      kit build in the simulator before doing anything else native. Uploads use the Gemini Files API.
- [ ] First-party plugins: Haptics (card flip, correct answer), Local Notifications (SRS reviews due;
      ask for permission after the first study session, not at launch), Share (export guides and
      kits), Filesystem, Browser (AI Studio link), Preferences.
- [ ] **Podcast playback through a native player** with the `audio` background mode and lock-screen
      controls. Today `src/pages/Podcast.tsx` uses a plain `<audio>` element, which iOS suspends in
      the background. Capawesome's audio plugin is the candidate.
- [ ] **Native speech recognition** for Explain it back (today it relies on keyboard dictation, which
      still works, but native is a visible 4.2 point). Needs `NSSpeechRecognitionUsageDescription`
      and `NSMicrophoneUsageDescription` in Info.plist. Candidate: `@capgo/capacitor-speech-recognition`.
- [ ] **Storage durability.** iOS can evict WKWebView IndexedDB under storage pressure. Mirror study
      data to Filesystem, or treat encrypted sync as the durable copy and say so. Avoid the community
      SQLite plugin (SQLCipher can add an annual export-compliance report).
- [ ] **Swift bridges** for what plugins don't cover: StoreKit 2 purchase and restore of the
      non-consumable, Keychain storage of the Gemini key, and Declared Age Range (iOS 26+,
      needs the entitlement).
- [ ] **Native feel:** safe-area tab bar, swipe-back, no rubber-band scrolling or long-press callouts
      on UI chrome, iPad Split View sizes.
- [ ] `PrivacyInfo.xcprivacy` privacy manifest (Capacitor docs have a template).
- [ ] App icon and launch screen from `public/logo.png` and the penguin art.

## Phase 4: App Store Connect setup

- [ ] Age rating: answer the questionnaire honestly, then set the minimum to **18+**. Screenshots
      must still be suitable for all ages.
- [ ] Privacy label: sync ciphertext = "Other User Content", not linked to the user, App
      Functionality. Course material goes from the device to Google under the user's own key.
- [ ] Export compliance: AES-GCM via WebCrypto is a standard algorithm; set
      `ITSAppUsesNonExemptEncryption` accordingly (exempt; no CCATS).
- [ ] Storefronts: US and other non-EEA countries where the Gemini API is available. Leave out the
      EEA, UK and Switzerland for v1 (Gemini terms require paid keys there).
- [ ] In-app purchase: one non-consumable, "Full version".
- [ ] Listing: name, subtitle "Study kits from your notes", category Education. No pricing words or
      competitor names in metadata.
- [ ] Review notes: the app is free and works offline; AI connects to the user's own Google AI Studio
      account and the app sells no AI access of its own; the only purchase is the non-consumable
      (list what it adds); the paid-tier test key; steps to see each native feature (Airplane Mode,
      a reminder, lock-screen audio).

## Phase 5: TestFlight on real devices

- [ ] A full study session in Airplane Mode (reviewers test offline).
- [ ] Podcast keeps playing on the lock screen with controls.
- [ ] Notification permission appears at a sensible moment.
- [ ] Sandbox purchase, restore, and the trial-kit limit.
- [ ] Declared Age Range sandbox for each age band; Gemini features hidden under 18.
- [ ] Sync between the iOS app and the web PWA with one sync code.
- [ ] iPhone and iPad, light and dark.

## Phase 6: submit

- [ ] Submit with the review notes and the funded key. Expect about 48 hours; a first app of a new
      kind can get extra scrutiny.

## If review fails

- **3.1.1 (purchase rules):** flip `AI_IN_FREE_TIER` and resubmit.
- **5.2.2 (third-party service permission):** reply with the 18+ rating, the age gate, the consent
  screen, and that each key is the user's own Google account under Google's terms. If that fails,
  ship with Gemini features off and pull the on-device model work forward.
- **4.2 (minimum functionality):** reply with a specific list of changes and bring the widget
  forward.
- **Name refused:** next name on the shortlist; nothing else changes.

## Later

- v1.1: "due today" home-screen widget (App Group needed); EEA/UK/CH with a billing-enabled-key
  confirmation; optional consumable tip jar; move the price to $4.99.
- v1.2 (iOS 27): Apple's on-device Foundation Models for grading and Explain it back, Private Cloud
  Compute for kit generation. It is the only AI path with no provider age clause, so it is the way to
  serve under-18s and the hedge if Google ever objects to consumer bring-your-own-key apps.

## Why (key facts, checked 2026-10-14)

- **Gemini API terms** (effective 2026-03-23) require users to be 18+, bar apps "likely to be
  accessed by individuals under the age of 18", say the API is "not for consumer use", allow only
  paid keys for EEA/UK/CH users, and let Google train on free-tier prompts.
  https://ai.google.dev/gemini-api/terms. The same under-18 clause is in the Google Cloud/Vertex
  terms, so moving to Firebase or Vertex doesn't escape it. Google staff decline to interpret it.
- **Apple 3.1.1:** in Sept 2024 Apple rejected a paid-upfront "insert your API key" app because
  "the app uses API keys to unlock or enable functionality" and suggested in-app purchases instead.
  https://developer.apple.com/forums/thread/763884. All 14 live bring-your-own-key iOS apps found
  are free downloads; several sell a one-time unlock (Pal Chat $6.99, OpenCat $9.99, Offline AI).
- **Name:** "Mnemo" is a live App Store app since 2023 (id6463660490); about 20 apps start with
  "Mnemo"; Mnemo, Inc. holds an allowed US trademark application for MNEMO in software classes
  (serial 99547128). App Store names must be unique.
- **4.2:** Apple rejects web wrappers whose core flow feels like a website; plugins alone ("not
  robust enough") don't fix it. Offline study, no outbound links and native audio, notifications
  and speech are what count.
- **Economics:** $2.99 nets about $2.54 at the 15% rate; the $99/year fee is covered by about 39
  sales. Competitors are $5 to $25 a month subscriptions; Thea charges $12/month or $48/year.
