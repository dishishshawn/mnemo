# Four workarounds clear Mnemo's App Store path

Each of the four blockers has a workaround that keeps bring-your-own-key and one-time pricing. None of them works with the original plan of a $2.99 paid download. The launch that clears all four is a **free download with one non-consumable unlock ($2.99 at launch, $4.99 list price). The unlock switches on AI study kits that run on the user's own Gemini key. The app is rated 18+ with an in-app age gate, is sold first outside the EEA, UK and Switzerland, is renamed (Memorook first, then Recallery or Penmemo), and is wrapped in Capacitor 8 with offline study, haptics, review reminders, native dictation and lock-screen podcast audio.**

Google's terms are the hardest constraint, for three reasons:

- **The under-18 clause is the same on every Google route.** It applies to bring-your-own-key, to Firebase AI Logic and to Vertex.
- **There is no consumer Google login left to borrow.** Google shut off Gemini CLI's login for consumers on June 18, 2026.
- **Google will not interpret the clause.** At least eight developers asked Mnemo's exact question on Google's forum, and the replies were either nothing or "We can't provide specific legal guidance."

The only AI path with no age clause is Apple's on-device model. It is the right second step but not something the launch has to wait for.

The 3.1.1 risk is mostly about how the app is packaged:

- **Every bring-your-own-key app found live on October 14, 2026 is a free download.** That is fourteen apps, and none is paid-upfront.
- **The one written rejection proposed the fix.** It told the developer to sell the "unlocked content" as in-app purchases, which is the recommended structure here.

"Mnemo" itself cannot be used. The exact name has been live on the App Store since 2023, about twenty other apps start with "Mnemo", and a US MNEMO trademark has been allowed in the software classes. Guideline 4.2 is judged on what the reviewer experiences, not on the framework, and Mnemo's offline-first design already covers most of that.

The longest wait is not code. Apple enrollment, the Paid Apps Agreement and banking take one to three weeks, so they start on day one.

## Google's age clause follows Mnemo onto every Google backend

Google's Gemini API Additional Terms impose five constraints on a study app:

- users must be 18 or older;
- an app must not be "directed towards or ... likely to be accessed by individuals under the age of 18";
- the API is "for professional or business purposes, not for consumer use";
- only Paid Services may serve users in the EEA, Switzerland or the UK;
- free-tier prompts are used to improve Google's products and may be read by human reviewers.

All five come from the same page ([Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)).

The obvious escape is to stop using the student's key and switch to Google's supported mobile route. That does not remove the clause that matters most. Firebase AI Logic is how Google supports calling Gemini from a shipped app. The developer's key stays behind a free Google proxy, App Check verifies that each request comes from the real app, and per-user rate limits are on by default ([Firebase AI Logic](https://firebase.google.com/docs/ai-logic)). The age clause survives on both of its backends:

- **Gemini Developer API backend:** still "subject to their specific terms", meaning the Gemini terms above ([Firebase Terms](https://firebase.google.com/terms)).
- **Vertex/Agent Platform backend:** governed by Google Cloud's Service Specific Terms. Their Generative AI section repeats the sentence almost word for word, forbidding use in any "Customer Application ... directed towards or is likely to be accessed by individuals under the age of 18". It also lets Google "immediately suspend or terminate" a customer on suspicion of a breach ([Google Cloud Service Specific Terms](https://cloud.google.com/terms/service-terms)).

The Cloud route does buy real things:

- there is no "consumer use" sentence;
- Google commits not to train on customer data without permission;
- prompts are kept at most 30 days, for abuse review only;
- Google indemnifies generated output against IP claims.

All four are in the same Cloud terms. The trade is still poor: a contract problem that sat with each student's key becomes one that sits with the developer, and the developer's own billing account is what gets suspended.

The Cloud route also flips Mnemo's economics. Mnemo's own estimate is **$1.50-9 per active student per month** at Gemini 2.5 Flash-class prices.

- That range still holds on Gemini 3.5 Flash-Lite ($0.30 input / $2.50 output per million tokens).
- It runs 1.5-2.5x higher on Gemini 3.8 Flash ($0.75 / $3.75).
- 3.8 Flash's price doubles to $1.50 / $7.50 on January 1, 2027 ([Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)).

A $4.99 one-time sale nets about $4.24 at Apple's 15% Small Business rate ([Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/)). That covers under three months of the lightest student and under one month of the heaviest. Paying for inference yourself therefore forces either a subscription or consumable "AI credits" with caps, which is exactly the metered model Mnemo's positioning rejects. Cheaper models such as Claude Haiku 5.5 ($0.10 / $0.50) and Gemini 3.1 Flash-Lite ($0.25 / $1.50) narrow the gap but do not close it ([Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing); [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)).

### No consumer login exists, and other providers have the same age rule

There is no way to borrow the student's own Google allowance either. On June 18, 2026 Google stopped serving Gemini CLI and Code Assist to free individuals and to AI Pro and Ultra subscribers. That leaves paid API keys and enterprise licences as the only routes ([Google Developers Blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)). No "Sign in with Gemini" product exists.

Other providers differ on logins, but not on age:

- **OpenAI:** "Sign in with ChatGPT" lets Plus and Pro users spend their plan allowance inside third-party apps. A paid or remotely hosted app must first "complete the interest form" ([OpenAI developer docs](https://developers.openai.com/siwc/token-sharing-open-source)).
- **Anthropic, on subscriptions:** it forbids developers to "route requests through Free, Pro, or Max plan credentials on behalf of their users".
- **Anthropic, on keys:** its rules do "not restrict how customers provision and manage their own API keys ... provided the resulting usage is billed to the key owner". This is the clearest written approval of bring-your-own-key from any provider, though it sits on Anthropic's Claude Code legal page ([Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)).

None of this solves the age problem:

- Anthropic's Commercial Terms also say "not for consumer use", and its Consumer Terms require users to be 18 ([Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms); [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)).
- Groq and OpenRouter require key holders to be 18 ([Groq Services Agreement](https://console.groq.com/docs/legal/services-agreement); [OpenRouter Terms](https://openrouter.ai/terms)).
- Mistral forbids granting third parties access "without our prior written authorization" ([Mistral Commercial Terms](https://legal.mistral.ai/terms/commercial-terms-of-service)).
- Only Together AI admits minors as account holders, at 13+ with a parent's consent ([Together AI Terms](https://www.together.ai/terms-of-service)).

Groq's agreement shows Google had a choice. It uses Google's own trigger phrase, an app "likely to be accessed by individuals under the age of majority", but turns it into a duty to follow laws on minors rather than a ban ([Groq Services Agreement](https://console.groq.com/docs/legal/services-agreement)). Google did not draft it that way.

### Apple's on-device model is the only AI with no provider age clause

Apple's on-device Foundation Model needs no key and carries no third-party terms. It supports typed `@Generable` output and tool calls. Apple positions it for "summarization, entity extraction, text and image understanding, refinement", and says to use a server model "when you need more reasoning capabilities and context size" ([Foundation Models](https://developer.apple.com/documentation/foundationmodels)). Its limits are strict:

- **Context:** a 4,096-token window per session, which must hold the prompt, instructions, schema and output ([Managing the context window](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)).
- **Languages:** 16.
- **Hardware:** Apple Intelligence devices only, meaning iPhone 15 Pro, iPhone 16 and later, iPhone Air, M1-or-later iPads and the A17 Pro iPad mini ([Apple Support](https://support.apple.com/en-us/121115)).

Grading short answers and checking explain-it-back coverage fit inside that window. Generating a kit from a 30-page PDF does not fit in one go: it would mean splitting the PDF into 10-20 separate sessions, and nobody has published any test of how well this model writes wrong-answer options for multiple-choice questions.

iOS 27 adds Private Cloud Compute, Apple's server-side model:

- it raises the window to 32K and adds reasoning levels;
- it needs no keys;
- it costs developers nothing if they are in the Small Business Program and have under 2 million first-time downloads;
- users get a daily quota, and Apple says wider access "will be available for a fee in the future" ([PCC documentation](https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute); [Accessing Private Cloud Compute](https://developer.apple.com/private-cloud-compute/)).

Two related options do not help with age. Firebase's preview `GeminiLanguageModel` adapter lets the same Swift code switch between Apple's model and developer-paid Gemini on each call, but the Gemini side keeps Google's age clause ([Firebase blog](https://firebase.blog/posts/2026/06/apple-foundation-models-gemini)). Chrome's Gemini Nano does not matter here, because its Prompt API does not run on iOS or Safari ([Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api)).

### Google will not interpret "likely to be accessed by", so build a record instead

Between May and October 2026 at least eight developers asked versions of Mnemo's question on Google's forum. They included an adult consumer iOS bring-your-own-key app and a high-school learning app. The replies were either nothing or "We can't provide specific legal guidance on this forum" ([thread 184477](https://discuss.ai.google.dev/t/is-bring-your-own-gemini-api-key-allowed-in-an-adult-consumer-ios-app/184477); [thread 185614](https://discuss.ai.google.dev/t/does-byok-allow-gemini-api-use-in-an-app-likely-to-be-accessed-by-under-18-students/185614)). One thread asked whether a 3+ app could limit only its AI feature to adults, and it has no reply at all ([thread 179916](https://discuss.ai.google.dev/t/age-restrictions-in-gemini-api-terms-general-audience-app-rated-3-with-an-adult-only-ai-feature/179916)). No enforcement against any bring-your-own-key app was found.

App Review does not appear to police the clause either. MealTime, a 4+ consumer recipe app, tells users "Google's free tier needs only a Google account, no card". It was approved in March 2026 and updated in September ([iTunes Lookup](https://itunes.apple.com/lookup?id=6758350120&country=us)).

The real exposure is two-sided:

- **Google's contract:** the "API Client" sentence plausibly binds Mnemo's developer, not just each key holder.
- **Apple's Guideline 5.2.2:** an app using a third-party service must be "specifically permitted", and "Authorization must be provided upon request" ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).

Written permission from Google cannot be obtained. The best substitute is a record showing Mnemo does not target minors:

- an 18+ rating, set with Apple's option to choose "a higher age rating" ([Apple Developer News](https://developer.apple.com/news/?id=ks775ehf));
- Apple's Declared Age Range API gating the Gemini features at 18. It needs iOS 26 or later and reports whether the age was self-declared, declared by a guardian, or confirmed by card or ID ([Declared Age Range](https://developer.apple.com/documentation/declaredagerange/requesting-people-share-their-age-range-with-your-app));
- marketing aimed at university and professional-exam students;
- in-app text saying Google requires key holders to be 18.

Apple itself warns that this data is declared, not verified, and that the developer is "solely responsible" for compliance (same source). So the record turns "likely to be accessed by minors" from an obvious yes into an arguable no. It does not settle the question.

One more design falls short. A 13+ app with the AI hidden from minors only works if "API Client" means the AI feature rather than the whole app. Google has not confirmed that reading.

### The other three clauses have cheap answers

- **EEA, UK and Switzerland paid-key rule.** Either ask users there to confirm they have a billing-enabled key, or leave those storefronts out of the first release. Leaving them out costs one checkbox per country in App Store Connect and no code.
- **Free-tier training.** This is a disclosure job. Apple's Guideline 5.1.2(i) already requires explicit permission before sending data to third-party AI. The consent screen should say that on a free key Google may use uploads to improve its products and human reviewers may read them, and that a billing-enabled key opts out ([Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)).
- **"Not for consumer use."** This has no fix on the Gemini Developer API. The sentence was absent from the December 2024 terms and present by March 2026, so it shows where Google is heading ([terms preview, Dec 2024](https://ai.google.dev/gemini-api/terms_preview)). The only Google route without it is the developer-paid Cloud route already ruled out above. It is a remaining risk to accept with open eyes and to hedge with code that can swap providers.

| Rank | Option | Effort | Risk | Verdict |
|---|---|---|---|---|
| 1 | Bring-your-own Gemini key; 18+ rating; Declared Age Range gate on AI; adult-focused marketing; consent and free-tier disclosure; leave out EEA/UK/CH at first | Days | Medium-low: arguably compliant; "not for consumer use" unresolved; no written approval from Google | **Pick for launch** |
| 2 | Apple on-device model for grading and explain-it-back, plus Private Cloud Compute for kits on iOS 27 | 2-4 weeks of Swift | Lowest for terms (no key, no age clause); quality unproven; 4K context; newer devices only | **Pick for v1.2** as the path for under-18s |
| 3 | Bring-your-own-key for several providers (Anthropic, Groq, OpenRouter) alongside Gemini | 1-2 weeks | Medium: every provider is 18+; spreads Google risk; no Anthropic free tier | Hedge in v1.x |
| 4 | Sign in with ChatGPT plan usage | Weeks plus OpenAI approval | Low-medium: OpenAI's consumer terms allow 13+ with parental permission | Optional later; only Plus/Pro users have it |
| 5 | Bring-your-own Gemini key for all ages at 13+ | None | High: direct conflict with "likely to be accessed by" minors; 5.2.2 exposure | Reject |
| 6 | Developer-paid Gemini through Firebase AI Logic or Vertex | Weeks | Medium: drops the consumer and training clauses but keeps the age clause with immediate suspension | Reject: $1.50-9+ per student per month forces a subscription |
| 7 | Sign in with Google and use the student's Gemini allowance | Not possible | Not applicable | Does not exist after June 18, 2026 |

Option 1 is the right launch choice for four reasons:

- it is the only option that keeps inference cost at zero for the developer, and so keeps one-time pricing viable;
- it costs days rather than weeks;
- the people most willing to set up a key are older and more technical students, so an adult audience costs less market than it seems;
- self-rating 18+ will not stand out, because Pal Chat, OpenCat and Geeps all rate themselves 18+ ([Pal Chat](https://apps.apple.com/us/app/pal-chat-ai-chat-client/id6447545085); [OpenCat](https://apps.apple.com/us/app/opencat-chat-with-ai-bot/id6445999201); [Geeps](https://apps.apple.com/us/app/geeps-ai-chat-byok/id6476961115)).

Option 2 is the first investment after launch. It is the only design found that could serve high-schoolers without depending on Google staying silent. Capacitor's official plugin list now includes a Local LLM plugin that may shorten that work, though whether it covers Apple's framework was not verified ([Capacitor plugins](https://capacitorjs.com/docs/plugins)).

## Fourteen live bring-your-own-key apps, and not one is a paid download

A sweep of the App Store, Apple's developer forums and Hacker News on October 14, 2026 found fourteen live iOS apps that take a user's own key (or a key-like credential). **Every one is a free download.**

- **Six charge nothing.** One is FlashcardGPT, a flashcard app published by a school. It says it "requires the user's own API Key from OpenAI" and has been live since 2023 ([FlashcardGPT](https://apps.apple.com/us/app/flashcardgpt/id6469199394)).
- **Six sell a one-time non-consumable**, from Pal Chat Pro at $6.99 to Offline AI Premium at $19.99 ([Pal Chat](https://apps.apple.com/us/app/pal-chat-ai-chat-client/id6447545085); [Offline AI](https://apps.apple.com/us/app/offline-ai-private-local-gpt/id6748595214)).
- **Two sell subscriptions.**

The only paid-upfront AI chat apps take no key at all: Private LLM ($4.99) and OfflineLLM ($5.99) run models on the device ([Private LLM](https://apps.apple.com/us/app/private-llm-local-ai-chat/id6448106860); [OfflineLLM](https://itunes.apple.com/lookup?id=6474508768&country=us)). The one $1.99 bring-your-own-key app that search engines still listed, LLM Chat Client, no longer resolves in the US, UK or Indian storefronts ([iTunes Lookup](https://itunes.apple.com/lookup?id=6757767087&country=us)).

The written record is thin, but it all points the same way:

- **September 2024:** Apple rejected a "pay once, insert your OpenAI/Claude key" app because "the app uses API keys to unlock or enable functionality". The rejection added: "You may also consider making this unlocked content available to your users as in-app purchases." Two years later the thread still has no outcome ([forum 763884](https://developer.apple.com/forums/thread/763884)).
- **2018:** the same "mechanisms other than in-app purchase" template hit a free teacher app whose students typed a "Lesson ID", so it fires even when no money changes hands ([forum 109627](https://developer.apple.com/forums/thread/109627)).
- **2022-23:** developers fighting product-key rejections said reviewers ignored the 3.1.3(b) argument. They also said Apple Support accepted a username and password in place of the key, "even if the password is actually the license key" ([forum 713044](https://developer.apple.com/forums/thread/713044)).
- **2025:** reviewers rejected an app seven times as "an OpenAI wrapper" even though it ran its own CoreML models. Reviewers react to what the app looks like, not how it bills ([forum 794306](https://developer.apple.com/forums/thread/794306)).

Apple's exceptions in 3.1.3 do not fit a third-party key:

- **3.1.3(b)** covers items "acquired in your app on other platforms or your web site", and those items must also be sold as in-app purchases.
- **3.1.3(a)** is limited to "magazines, newspapers, books, audio, music, and video".
- **3.1.3(f)** is the closest in spirit, but it only applies to free companion apps ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).

| Rank | Option | Effort | 3.1.1 risk | Revenue shape | Verdict |
|---|---|---|---|---|---|
| 1 | Free download; one non-consumable unlocks AI kits (on the user's key) plus sync and extras; demo kits and manual study free (Offline AI / Lori model) | Medium | Lowest: exactly the fix the reviewer suggested | Core feature behind the unlock | **Pick** |
| 2 | Free download; AI free on the user's key; non-consumable sells only non-AI conveniences (OpenCat / Geeps / AI Notes model) | Medium | Low: approved repeatedly since 2023 | Freemium; few buyers | **Fallback** behind a config flag |
| 3 | Position as a developer tool (Developer Tools category, "for key holders" naming) | Low | Low | Bad for student search visibility | Not suitable for a study app |
| 4 | Paid upfront, useful without a key, key described as a connection, test key for the reviewer | Low | Medium-high: still the shape that was rejected; an empty-looking paid app also risks 2.1/4.2 | No trial | Reject |
| 5 | Argue 3.1.3(a), (b) or (f) in an appeal | Low | High: the text does not fit, and reviewers ignore it | — | Do not lead with it |
| 6 | Sell a web licence and link to it from the US app | Medium-high | High outside the US: a licence key is itself a 3.1.1 mechanism | Fees of 13-22% at $2.99 | Reject |
| 7 | Paid upfront at $2.99, key required | Lowest | Highest: written rejection, no app of this shape found surviving | No trial | Reject |

### Why rank 1 beats rank 2

Option 1 sells AI kits through Apple's in-app purchase and treats the key as a connection, so there is nothing left for 3.1.1 to object to. It is live today in Offline AI, whose version 1.1 "Added a one-time Premium unlock for cloud AI providers" ([Offline AI](https://apps.apple.com/us/app/offline-ai-private-local-gpt/id6748595214)). Lori is reported to work the same way: users "bring their own OpenAI key ... after one non-subscription purchase", though its listing could not be loaded to confirm ([Lori listing](https://apps.apple.com/us/app/ai-chat-companion-lori/id6446085163)).

It also earns more, because the feature people download the app for sits behind the purchase. RevenueCat's 2026 subscription data shows apps that must be paid for before use converting **10.7%** of downloads to paying customers, against **2.1% for freemium** ([RevenueCat SOSA 2026 Education](https://www.revenuecat.com/state-of-subscription-apps-2026-education)). Those figures come from subscription apps, and option 1 sits between the two models, so treat them as a direction rather than a forecast. At 1,000 downloads and a $2.99 unlock, they imply roughly $272 for option 1 against $53 for option 2. Paid-upfront buys nothing in return: Apple's 15% Small Business commission is the same for paid apps and in-app purchases ([Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/)).

Option 2 is the fallback for one reason. Charging for Gemini-powered features does fit 5.2.2's wording about apps that "monetize access to" a third-party service. If a reviewer raises that, flipping to the OpenCat model (AI free on your key, unlock sells sync, export and unlimited saved kits) should be a config change, not a rebuild.

On price, $2.99 is below every verified one-time unlock in this category ($6.99-19.99). RevenueCat's lifetime-pricing guide says "if in doubt ... going higher rather than lower" ([RevenueCat lifetime guide](https://www.revenuecat.com/blog/growth/lifetime-subscriptions)). That supports $2.99 as a launch price and $4.99 as the list price.

### How to present the key and brief the reviewer

- **Key screen wording.** Say "Connect your Google AI Studio account (free key)", and never "unlock" or "activate". This copies the substitution that worked in the product-key cases.
- **Link to Google.** A link to aistudio.google.com is not a link to a purchase, in any storefront. MealTime's approved copy is a usable template.
- **US anti-steering rules.** The May 2025 change still stands in the live guidelines. The Supreme Court took Apple's appeal on June 30, 2026, so it could change in 2027 ([Oyez 25-1311](https://www.oyez.org/cases/2026/25-1311)), but a non-consumable in-app purchase is unaffected either way.
- **Test key for the reviewer.** Apple's review guidance says to supply any "authentication code" in the Notes field ([Apple App Review](https://developer.apple.com/distribute/app-review)). A 2026 app that talked only to the user's own server was rejected under 2.1 when the reviewer could not reach it ([forum 815919](https://developer.apple.com/forums/thread/815919)). So the notes need a funded paid-tier Gemini key, not a free key that may hit rate limits.
- **Tips.** Any "pay what you want" option must be a consumable in-app purchase. The only exception in 3.2.1(vii) is person-to-person gifts where 100% reaches the receiver ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).

## "Mnemo" is taken three times over

App Store Connect enforces unique names itself. Apple's help page only says a name must be 2-30 characters and can be edited until submission ([App Store Connect Help](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)). The field returns "the app name you entered is already being used" and points trademark holders to a claim form ([forum 711244](https://developer.apple.com/forums/thread/711244)). Apple's product-page guide also tells developers to avoid names "too similar to existing app names" ([Apple: Creating your product page](https://developer.apple.com/app-store/product-page/)).

"Mnemo" fails on three counts:

- **The exact name is held.** Keiichirou Hayashi's spaced-repetition app has used it since August 2023. It has had no update since May 2024, but inactive apps keep their names indefinitely ([iTunes Lookup](https://itunes.apple.com/lookup?id=6463660490)).
- **The prefix is crowded.** About twenty live apps start with "Mnemo", six of them flashcard apps. The newest, "Mnemo: Flashcards & Vocabulary", launched September 18, 2026 with a pitch close to Mnemo's own: "No sign-up, no ads. Works offline" ([iTunes Lookup](https://itunes.apple.com/lookup?id=6811566830); [iTunes Search](https://itunes.apple.com/search?term=mnemo&entity=software&limit=50&country=us)).
- **The trademark is spoken for.** Mnemo, Inc. of Merchantville, NJ filed for the word mark MNEMO in Classes 9 and 42 (software). It received a Notice of Allowance in July 2026 ([GleanMark 99547128](https://gleanmark.com/trademark/uspto-99547128)). That makes it senior to anything Shawn could file now. Apple's App Name Dispute form is for people with trademark rights to the name ([Apple Legal](https://www.apple.com/legal/intellectual-property/dispute-forms/app-store)), so it is not available to him.

| Rank | Option | Effort | Risk | Verdict |
|---|---|---|---|---|
| 1 | Invented name that is clean on five storefronts and in US trademarks: Memorook, Recallery, Penmemo, Memoglyph | Low: rename strings, icon wordmark, domain | Low; confirm by creating the App Store Connect record | **Pick** |
| 2 | Mnemonote (invented, but Mnemo-prefixed) | Low | Medium: crowded prefix; the MNEMO mark | Backup only |
| 3 | Compound names: "Mnemo Study", "Mnemo AI", "Mnemo: Study Kits" | Lowest | Medium-high: likely passes the uniqueness check, but six flashcard apps share the prefix, Apple's "too similar" guidance and 4.3(b) apply, and the mark can never be owned | Avoid |
| 4 | Different store name, home-screen label kept as "Mnemo" | Low | Medium: 2.3.8 expects names to match | Avoid |
| 5 | Penguin or dictionary words (Rookery, Huddle, Waddle, Pengo, Study Penguin, Memoria, Recallo, Mnemosyne) | Low | High: each is taken on the store or has a live Class 9/42 mark | Reject |
| 6 | Punctuation or case variants ("MNEMO", "Mnemo.") | Lowest | High: matched case-insensitively; 2.3.7 and 4.1 at review | Reject |
| 7 | App Name Dispute, or buying the name | High | Not available without trademark rights | Not available |

Five invented names returned zero exact matches in the US, UK, Japanese, German and French storefronts, and zero live US trademark records: **Memorook, Recallery, Penmemo, Memoglyph and Mnemonote** ([iTunes Search, e.g. Mnemonote](https://itunes.apple.com/search?term=mnemonote&entity=software&limit=50&country=us); [Trademarkia](https://www.trademarkia.com/search/trademarks?query=mnemonote)). Every penguin-themed dictionary word tried was already taken. "Study Penguin" itself shipped in July 2026 ([iTunes Search](https://itunes.apple.com/search?term=penguin+study&entity=software&limit=25&country=us)), and Rookery and Huddle carry live software trademarks ([Trademarkia: rookery](https://www.trademarkia.com/search/trademarks?query=rookery); [Trademarkia: huddle](https://www.trademarkia.com/search/trademarks?query=huddle)).

**Memorook** is the first choice. It joins memory with "rookery", the word for a penguin colony, so it keeps the mascot that is already in the app. It is also a made-up word, the easiest kind of trademark to register later. Recallery is second because it describes the product best, then Penmemo. Mnemonote is last because it keeps every problem the prefix has.

Three checks remain open: the trademark search covered only the US, and neither Google Play nor domain names were checked. The definitive test takes minutes: create the app record in App Store Connect once enrollment is active.

Metadata rules shape the rest of the listing. Guideline 2.3.7 bars "pricing information" and "popular app names" in metadata ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). So a subtitle such as "Study kits from your notes" is safe, while "pay once" and any mention of Thea belong only inside the app.

## Reviewers judge the flow, not the framework

Guideline 4.2 asks for "features, content, and UI that elevate it beyond a repackaged website" ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). The public cases show reviewers acting on what they experience, not on lists of plugins:

- **January 2026:** a Capacitor booking app added Core Location, a share sheet and a clipboard bridge and was still rejected twice. Apple said such features "alone are not robust enough", and the app's core flow ran inside a third-party web page ([forum 812889](https://developer.apple.com/forums/thread/812889)).
- **December 2020:** the only fully documented recovery is an Ionic app. It passed on its third submission after removing its in-app browser and most outbound links, improving offline behaviour, adding content and explaining itself in the review notes. Apple's second rejection had said push notifications "did not make the app robust enough" ([Ionic Forum 200908](https://forum.ionicframework.com/t/app-store-rejection-4-2-design-minimum-functionality-my-first-after-2-years-of-ionic/200908)).
- **Airplane Mode:** a 2026 vendor checklist says reviewers put the device in Airplane Mode ([code2native](https://code2native.com/blog/fix-app-store-rejection-42-webview)).

Mnemo's IndexedDB study loop already passes that test. That is the strongest 4.2 signal it can send, and it is already built.

| Rank | Route | Effort | 4.2 / product risk | Verdict |
|---|---|---|---|---|
| 1 | Capacitor 8 with the Vite build bundled inside, no remote `server.url` | Low-medium; needs a Mac with Xcode 26 | Low-medium; every needed bridge exists | **Pick** |
| 2 | Stay a PWA and sell a web licence | Little code, more operations | No 4.2 at all, but no store listing, a five-tap install, unreliable background audio, 13-22% fees | Keep as the free web version |
| 3 | Hand-made SwiftUI/WKWebView shell (PWABuilder) | Medium; every bridge written by hand | Medium-high; its own makers call it "Experimental" | Reject |
| 4 | Tauri 2 mobile | Medium-high; Rust, plus Swift for share, speech and audio; no iOS SQL plugin | Medium; one App Store pass on record, no 4.2 data | Reject |
| 5 | Full native SwiftUI rewrite | Very high | Lowest | Not justified |

Capacitor wins on coverage. Its official plugins cover haptics, share, local notifications, preferences, filesystem and an in-app browser. The gaps all have maintained community plugins: speech recognition, a file picker, and background audio with lock-screen controls ([Capacitor plugins](https://capacitorjs.com/docs/plugins); [Capgo speech recognition](https://awesome.ecosyste.ms/projects/github.com%2Fcap-go%2Fcapacitor-speech-recognition); [Capawesome plugins](https://capawesome.io/plugins/)). Capacitor 8 needs Xcode 26 and targets iOS 15 and later. Apple has required builds from Xcode 26 since April 28, 2026, so the real cost is getting time on a Mac, not the JavaScript work ([Capacitor 8 update guide](https://capacitorjs.com/docs/updating/8-0); [Capacitor environment setup](https://capacitorjs.com/docs/next/getting-started/environment-setup)).

The alternatives each fall short:

- **Tauri 2:** its official SQL plugin does not support iOS, and it has no share-sheet, speech or background-audio plugin ([Tauri SQL plugin](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/README.md)).
- **PWABuilder:** its iOS output is "Experimental", and its docs say acceptance depends on "UI/UX of your PWA and usage of native capabilities" ([pwabuilder-ios](https://github.com/pwa-builder/pwabuilder-ios)).
- **Staying a PWA:**
  - iOS 26 does make every site installable ([WebKit, Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
  - But Web Audio in home-screen apps works "only ... on the first run" on iOS 26 ([WebKit bug 295518](https://bugs.webkit.org/show_bug.cgi?id=295518)), which breaks podcast playback.
  - Install takes five taps ([forum 801602](https://developer.apple.com/forums/thread/801602)).
  - A $2.99 web sale loses $0.65 to Paddle or $0.39 to Stripe, against $0.45 to Apple ([Paddle pricing](https://www.paddle.com/pricing); [Stripe pricing](https://stripe.com/pricing)).

| Rank | Native touch | Effort | Credibility with reviewers | Ships in |
|---|---|---|---|---|
| 1 | Offline study loop, bundled assets, custom offline state | Already done | Highest | v1 |
| 2 | No outbound links in the main flow; Google key page opened in an in-app Safari view | Hours | Highest | v1 |
| 3 | Native feel: safe-area tab bar, swipe-back, no rubber-band scrolling or long-press callouts | Days | High | v1 |
| 4 | Lock-screen podcast playback through a native audio plugin | 1-2 days | High for this app | v1 |
| 5 | Local notifications for spaced-repetition reviews | Half a day | Medium-high | v1 |
| 6 | Native speech recognition for explain-it-back and dictation | Half a day | Medium-high | v1 |
| 7 | Haptics on card flip and correct answers | 1 hour | Medium | v1 |
| 8 | Share-sheet export of guides and kits | 1 hour | Medium (Apple has called it "not robust enough alone") | v1 |
| 9 | iPad Split View sizes | Hours | Medium | v1 |
| 10 | Home-screen widget showing reviews due today | 2-4 days, needs an App Group | High | v1.1 |
| 11 | App Intents / Siri "Start review" | 2-3 days of Swift | Medium | Later |
| 12 | Push notifications | Server plus APNs setup | Medium; local notifications cover the need | Skip |

Two technical details decide whether the native touches actually work:

- **Background audio.** iOS suspends the web view shortly after the app leaves the foreground, so podcast playback has to use a native player with the `audio` background mode ([Capawesome background audio](https://capawesome.io/blog/how-to-play-audio-in-the-background-in-capacitor/)).
- **Storage.** iOS can evict a WKWebView's IndexedDB under storage pressure ([Capacitor storage guide](https://capacitorjs.com/docs/guides/storage)). Mirror study data to the first-party Filesystem plugin, or make the encrypted sync copy the durable one. Avoid the community SQLite plugin: it uses SQLCipher, which can add an annual export-compliance report ([capacitor-community/sqlite](https://github.com/capacitor-community/sqlite)).

Widgets are a strong answer to 4.2 but cost the most effort ([Capgo Widget Kit](https://capgo.app/docs/plugins/widget-kit/)), so they wait for v1.1.

## The launch plan: free download, one unlock, adults first

### Pricing: a $2.99 launch unlock that becomes $4.99

The app is a free download in Education, with one non-consumable in-app purchase, the "Full version". It is never a subscription and never auto-renews.

**Free tier:**

- manual decks and spaced-repetition review;
- imports;
- the on-device exam planner;
- two bundled demo kits whose questions, guide and podcast were generated in advance, so no key is needed;
- one trial AI kit on the user's own key, after the age gate.

The trial kit lets a buyer confirm their key works before paying. That cuts refund requests and "I paid and it does nothing" reviews.

**The unlock adds:**

- unlimited AI kits;
- Smart Study question generation, short-answer grading and explain-it-back;
- podcast generation;
- encrypted cross-device sync;
- export.

**Price:** $2.99 for the launch window, then $4.99. At Apple's 15% Small Business rate that nets $2.54 and then $4.24 per sale.

A consumable tip jar (for example $1.99, $4.99 and $9.99 tiers that unlock nothing) can follow in v1.1. The same entitlement check should carry a config flag that moves AI generation out of the unlock and into the free tier (the OpenCat model) if a reviewer pushes back.

The free web PWA at the current Vercel URL competes with the paid app. It is reasonable to keep it as the free, web-only version and let the App Store build sell the native conveniences. But that decision should be deliberate, and the app should never link to it.

### Age rating and AI backend: 18+, bring-your-own Gemini key, non-EEA storefronts first

**Rating.** Answer Apple's age questionnaire honestly (AI-generated text from arbitrary course material will likely come out at 13+), then raise it to 18+. All screenshots must still be 4+ ([Apple Developer News](https://developer.apple.com/news/?id=ks775ehf)).

**Age gate.** Gate every Gemini feature on the Declared Age Range API at 18:

- if the system reports under 18, the Gemini features stay hidden;
- if the user declines to share, or the iOS version lacks the API, ask for an explicit "I am 18 or older" confirmation. Apple's data is self-declared too, so a direct confirmation is about equally strong evidence.

**Consent screen,** shown once before the first upload:

- notes go to the user's own Google account;
- on a free key Google may train on uploads and human reviewers may read them;
- Google requires key holders to be 18+;
- withdrawal is available in Settings.

**Key storage.** Store the key in the Keychain, not in Preferences.

**Model and cost display.** Show estimated cost per session. Remember that Gemini 3.8 Flash doubles in price on January 1, 2027 while 3.5 Flash-Lite does not ([Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)); the cheaper model is the honest default for users on paid keys.

**Storefronts.** Launch in the US and other non-EEA storefronts where Gemini is available, such as Canada and Australia ([Gemini available regions](https://ai.google.dev/gemini-api/docs/available-regions)). Add the EEA, UK and Switzerland in v1.1 with a billing-enabled-key confirmation.

**Privacy paperwork:**

- privacy label: sync ciphertext as "Other User Content", not linked to the user, used for app functionality ([Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/));
- a `PrivacyInfo.xcprivacy` manifest ([Capacitor privacy manifest](https://capacitorjs.com/docs/ios/privacy-manifest));
- export compliance: WebCrypto's AES-GCM qualifies for the standard-algorithm exemption ([Apple export compliance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)).

### Name: Memorook, then Recallery or Penmemo

Try Memorook first, Recallery second and Penmemo third. Memoglyph is a reserve. Use the subtitle "Study kits from your notes". The home-screen label should match the store name. Keep "inspired by Thea" in the About screen only.

### Wrapper and native features: Capacitor 8 with nine native items at launch

**Shell.** Bundle the Vite `dist/` into a Capacitor 8 iOS project with no remote server URL.

**v1 native items** (ranks 1-9 in the table above):

- offline loop;
- no outbound links;
- native navigation feel;
- lock-screen podcast audio;
- local review reminders;
- native speech recognition;
- haptics;
- share-sheet export;
- iPad Split View.

**Swift bridges to write.** Four pieces are not covered by first-party plugins and need small Swift bridges or vendor SDKs:

- StoreKit purchases, since Capacitor's official list has no in-app purchase plugin;
- Keychain storage;
- Declared Age Range;
- the background-audio player, if the Capawesome plugin does not fit.

**Review notes** should read as a short guide:

- the app is free and usable offline;
- AI connects to the user's own Google AI Studio account, and the app sells no AI access of its own;
- the only purchase is the non-consumable, with a list of what it unlocks;
- a funded paid-tier test key;
- the steps to feel each native feature, such as Airplane Mode, a reminder and lock-screen audio.

### Order of work: start the paperwork before the code

| Step | When | Work | Why now |
|---|---|---|---|
| 1 | Day 1 | Enroll in the Apple Developer Program ($99, individual; the legal name appears as the seller) ([Apple enrollment](https://developer.apple.com/programs/enroll/)). Once active, create the app record as Memorook to claim the name. Accept the Paid Apps Agreement, submit the W-9 and bank details, and join the Small Business Program. | Paid submissions are blocked until agreements are Active, and banking "Processing" has taken two days to a month ([App Store Connect agreements](https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements); [forum 115049](https://developer.apple.com/forums/thread/115049)). The reduced rate takes effect 15 days after the end of the month of approval ([Small Business Program](https://developer.apple.com/app-store/small-business-program/)). |
| 2 | Days 1-5, on Linux | Rename and rebrand. Build the entitlement gate with its flag, the demo kits, the trial kit, the age gate and consent screen, the "Connect" key copy, cost display and removal of outbound links. | Plain web code that does not need a Mac. Doing it first means the iOS shell wraps finished behaviour. |
| 3 | Week 2, on a Mac with Xcode 26 | Capacitor 8 shell; first-party plugins (Haptics, Local Notifications, Share, Filesystem, Browser); community speech and audio plugins; Swift bridges for StoreKit, Keychain and Declared Age Range; tab bar and iPad sizes. | Xcode 26 builds are mandatory, so this is the only Mac-dependent step. Keep it as small as possible. |
| 4 | Week 2 | App Store Connect paperwork: age questionnaire then 18+, privacy label, privacy manifest, export compliance, storefront list without EEA/UK/CH, privacy policy URL. | Each item is a rejection if missing, and none depends on the build. |
| 5 | Week 3 | TestFlight on a physical iPhone and iPad: a full session in Airplane Mode, lock-screen audio, notification-permission timing, sandbox purchase, and Declared Age Range sandbox for each age band. | Reviewers test offline and audio; WebView audio needs real hardware to verify. |
| 6 | Week 3 | Submit with the review notes and funded key. | Apple reports most reviews within 48 hours, but a first app of a new kind can draw "greater scrutiny" ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). |
| 7 | Weeks 4-8 | v1.1: "due today" widget; EEA/UK/CH with billing-key confirmation; tip jar; move list price to $4.99. | Widgets are the strongest later answer to 4.2, and the price rise follows early reviews. |
| 8 | iOS 27 cycle | v1.2: on-device grading and explain-it-back; Private Cloud Compute for kit generation; an optional second bring-your-own-key provider; reconsider 13+ with the Gemini side still gated. | This is the only path that reaches under-18s and does not depend on Google staying silent. |

### If a step fails

Each likely failure has a prepared next move:

- **3.1.1 rejection:** flip the flag to the OpenCat model and resubmit.
- **Apple asks for authorization under 5.2.2:** reply with the record: the 18+ rating, the age gate, the consent screen, and the fact that each key is the user's own Google account under Google's terms. If that fails, ship with the Gemini features off and pull v1.2 forward.
- **4.2 rejection:** reply with a specific list of changes, which is what vendor guides report reverses decisions ([zudo-tauri 4.2 guide](https://zudo-tauri-wisdom.takazudomodular.com/docs/mobile/app-store-review-4-2/)), and bring the widget forward.
- **Name refused:** use the next name on the shortlist. Steps 2-6 do not change.

## Conclusion

The four blockers come down to two decisions: who the customer is, and what Apple is selling. Once the customer is an adult and Apple sells an unlock instead of a download, three of the four blockers become paperwork and the fourth (the name) becomes a branding exercise. What the evidence rules out is not the $2.99 price, which works as a launch price, but the paid-upfront container. Nothing in the bring-your-own-key category has survived in that form, and it gives up both a free trial and the most effective place to put a paywall.

The most important strategic finding is that Apple's on-device model addresses three blockers at once. It is the only AI with no provider age clause. It makes the app useful without a key, which weakens any 3.1.1 objection. And it is a native capability a reviewer can see, which helps with 4.2. Apple's Private Cloud Compute adds larger-context generation at no API cost for small developers. That makes the on-device work the first post-launch investment. It is also the one hedge against the risk no engineering can remove: Google has declined to say whether consumer bring-your-own-key apps are allowed. The launch posture is built to be defensible evidence, not permission, and the provider-agnostic design means a change of heart at Google would mean losing a feature rather than losing the app.
