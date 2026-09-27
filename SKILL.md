---
name: council
description: Run a "council" to stress-test a decision, plan or whole project. Five independent advisors with different thinking styles (Contrarian, First Principles, Expansionist, Outsider, Executor) answer the same neutrally framed question in isolated subagents; five reviewers anonymously cross-review them (strongest, biggest blind spot, what all five missed); a chairman delivers a verdict with one concrete next step. Use whenever the user says "council this", "run the council", "LLM council", "second opinion", "stress-test this", "review the whole project", or faces a costly fork or a plan they want challenged rather than flattered. Skip for simple factual questions or when the user only wants validation.
---

# Council

## 1. What this skill does

One model asked one question tends to agree with whoever framed it. The council counters that by forcing several independent perspectives onto the same question, letting them criticize each other without knowing who wrote what, and then synthesizing a verdict.

Pipeline (method: Ole Lehmann's five-advisor council, built on Andrej Karpathy's LLM Council):

1. **Frame** the question neutrally and attach the real materials.
2. **Five advisors** answer in parallel, each in an isolated context, each with a different thinking style.
3. **Anonymize** the answers (real random shuffle, labels A-E).
4. **Five reviewers** read all five anonymous answers and answer three questions: which is strongest, which has the biggest blind spot, what did all five miss.
5. **Chairman** reads everything and returns a verdict, the disagreements, and **one concrete next step**.
6. **Report**: markdown transcript plus a single-file HTML report.

The "what did all five miss" question is the most valuable one. Keep it.

## 2. When to use it

Use it for decisions or reviews where being wrong is expensive: product or architecture forks, "should we pursue X", pricing, positioning, hiring, a plan the user keeps going back and forth on, or "review this whole project and list every issue".

Do not use it for factual lookups, small coding tasks, or when the user already decided and only wants validation. Say so briefly instead of running it. The council will tell people things they may not want to hear; that is the point.

## 3. Non-negotiable rules

These exist because a previous run broke them (see section 12).

1. **Isolation.** Every advisor, reviewer and the chairman is a separate subagent or session with fresh context. It receives only the prompt text defined in this skill, never the main conversation and never your own opinions. Advisors never see each other's answers.
2. **Neutral framing.** The framed question must not contain your conclusions, a preferred option, a list of "known problems", or loaded adjectives. Put the user's words and evidence in verbatim. If there are options, state them symmetrically and add "something else / none of these".
3. **Real anonymization.** Shuffle with a real random generator in code, save the mapping to a file, and never show reviewers names or the mapping.
4. **Never write a role's output yourself.** If you cannot spawn isolated subagents or sessions, stop and tell the user. Only if the user agrees, run a clearly labelled simulation and mark the whole report "SIMULATION: roles are not independent; rankings carry no evidential weight."
5. **Never fabricate votes.** Parse what actually came back. Drop failed members and record the drop.
6. **Tag claims.** `[FACT]` verified with a tool this run, `[MATERIALS]` stated in the provided materials but not verified, `[INFERENCE]` reasoning, `[OPINION]` judgement. Say "unverified" whenever it applies. Never invent numbers, sources or quotes.
7. **No flattery, no false balance.** Advisors disagree where they disagree. The chairman preserves minority views instead of averaging them away.
8. **Read-only advisors.** Advisors, reviewers and chairman may read files and search the web if allowed. They must not edit files, run state-changing commands, or call external services with side effects.
9. **Secrets.** When scanning the workspace, never read or include `.env`, credentials, private keys, tokens or key files. If the materials contain secrets, redact them and tell the user.

## 4. Inputs and defaults

| Input | Default | Meaning |
|---|---|---|
| `question` | the user's words, verbatim | What to decide or review |
| `materials` | auto-detected | Files or folders to include (README, AGENTS.md, docs, briefs, specs) |
| `mode` | `styles` | `styles` (five thinking styles), `models` (N different models, same plain question), `both` (styles, each on a different model) |
| `depth` | `standard` | `quick` (150-250 words per advisor), `standard` (300-500), `deep` (600-900) |
| `project_review` | auto | On when the user asks to review a whole project; adds section 6.3 and the issue register |
| `search` | off unless needed | Allow web search for current facts; findings are added to the materials as `[FACT]` with source |
| `models` | all the same | Optional map advisor to model; use different models when several providers are configured |
| `focus` | auto | Extra lenses appended to advisor prompts (section 6.6). `auto` turns them on per the question's shape; a caller may force `none`, `all`, or an explicit list such as `ux,scale,tracking` |
| `benchmark` | auto | On when the question is "is this good enough / how could this be better" and named comparables exist; adds Step 0.5, gathering how comparable products actually work, as `[FACT]` materials (section 5, Step 0.5) |

If the question is ambiguous, ask at most one clarifying question. Otherwise restate the decision neutrally and proceed.

## 5. Workflow

### Step 0: Collect materials
Read the user's files and, if relevant, `AGENTS.md`, `README`, `docs/`, notes. Include material verbatim or as exact excerpts plus a file list. Do not summarize in your own words and do not add commentary; summaries smuggle in your opinion. If material is too large, include the most relevant verbatim sections and list the rest by path so advisors can read them with tools. Skip secrets (rule 9).

### Step 0.5: Benchmark the comparables (only when `benchmark` is on)

When the question is "how could this be better" and the user names comparables (Blinkit, Zepto, Stripe, Linear, whatever they measure themselves against), an advisor who only sees the repository will invent what the comparable does. Replace that with fetched facts.

1. **Name the comparables and the axis.** Write them down neutrally: "compared to Blinkit and Zepto, on storefront layout, delivery-time presentation, live rider tracking, and peak order throughput."
2. **Fetch, do not recall.** For each comparable, gather what is *actually published* about the mechanism: their engineering blog, docs, a public post-mortem, the platform's own limits page. Tag every finding `[FACT]` with a source link and the date you read it. If a claim is only marketing copy, label it `[MATERIALS]` and say whose words they are.
3. **Include the platform limits that bound the project.** The comparables' scale is not your scale; the *limits of the tools the project actually uses* are the binding constraint. Pull the real numbers (for example Supabase Realtime concurrent connections and messages/second per plan, or the store's review SLA). These are usually the most decision-relevant `[FACT]`s in the whole run.
4. **State the scale gap explicitly.** Put the comparable's scale next to the project's next `[FACT]`: "Blinkit: ~125,000 orders/day across 153 cities; this project: one shop, target one order/day at pilot." An advisor who does not see the gap will recommend the comparable's architecture, which is almost always wrong here.
5. **Write the result to `benchmarks.md`** and append it to the materials block. Keep it factual: mechanisms and numbers, not "what we should copy". The moment it says "so we should do X", it has become a conclusion and is banned from the framed question (Step 1).

Skip this step when there is no comparable, when the question is purely internal (a bug, a policy), or when the user asked for a quick answer. Say which reason applied.

### Step 1: Frame
Write `framed-question.md` with exactly these sections:

```
## Decision
<one or two neutral sentences: what is being decided or reviewed>

## Options
<the real options, stated symmetrically, plus "something else / none">

## Constraints and context given by the user
<verbatim quotes of what the user said; nothing added by you>

## Materials
<verbatim excerpts with file paths>

## Current facts (only if search was used)
<findings with source links, labelled [FACT]>
```

Checklist before sending: no conclusion, no preferred option, no list of flaws, no adjectives like "weak" or "promising", options equally detailed. If you caught yourself leaning, rewrite. Show the user the Decision and Options sections and the cost estimate (section 10); proceed unless they object, or in non-interactive runs, proceed.

### Step 2: Advisors (parallel, isolated)
Spawn five subagents in a single batch so they run in parallel. Each receives the prompt from 6.1 + its persona from 6.2 + the framed question (+ 6.3 if project review) (+ 6.6 lenses if focus is on, at most two each). Collect the five responses. Retry a failed advisor once; need at least three to continue.

### Step 3: Anonymize
Write the five responses to files by style. Remove self-identification ("As the Contrarian...") from the text by replacing it with "[advisor]". Shuffle with real randomness, for example:

```
python3 -c "import random,json;s=['contrarian','first_principles','expansionist','outsider','executor'];random.shuffle(s);print(json.dumps(dict(zip('ABCDE',s))))" > mapping.json
```

Build `responses_text` as blocks `Response A:\n<text>` separated by a blank line.

### Step 4: Peer review (parallel, isolated)
Spawn five fresh reviewers. Each receives only the prompt in 6.4 with `{framed_question}` and `{responses_text}` filled in. Every reviewer sees all five responses, including the one it would have written. Keep each raw review. Parse the rankings (section 7).

### Step 5: Chairman (one fresh subagent, strongest available model)
Send only the prompt in 6.5. It gets the framed question, the five advisor responses with their real style names, the five raw reviews with anonymous labels, and the label-to-style mapping. Retry once on failure; if it still fails, deliver the raw stages and say synthesis failed.

### Step 6: Spot-check
You (the orchestrator) check the three to five highest-impact claims in the chairman's answer that a tool can verify (grep the repo, run a test, fetch a page). Record results in `verification.md` as confirmed, contradicted or unverifiable, and mark the final answer accordingly. Never silently fix a contradicted claim; show it.

### Step 7: Deliver
Write the files in section 8 and give the user the short chat summary.

## 6. Prompt library (use these texts as written)

### 6.1 Advisor wrapper

```
You are one advisor on a council. Several advisors will answer the same question independently; you will not see the others. Answer from your assigned thinking style only.

Rules:
- Be specific and evidence-based. Cite the materials by file or section.
- Tag each substantive claim [FACT], [MATERIALS], [INFERENCE] or [OPINION]. Say "unverified" when it applies. Never invent numbers, quotes or sources.
- Give a confidence (High / Medium / Low) for each major claim.
- Do not hedge to be agreeable. Disagree with the framing if it is wrong.
- Length: {length_words} words.
- End with one line: "One-line verdict: ..."

Your thinking style:
{persona}

The question:
{framed_question}
```

### 6.2 The five personas

**Contrarian**
```
Assume the idea, plan or project has a fatal flaw and find it. Look for what will fail, what is overclaimed, what evidence is missing, and what the author is too close to see. If everything looks solid, dig deeper and name the most likely way it fails anyway. Do not soften. Only propose a fix when it directly removes a flaw you found.
```

**First Principles Thinker**
```
Ignore how the question is phrased and ask what is actually being solved. List the assumptions hidden in the framing and challenge each one. Rebuild the problem from the ground up: what would you do starting from zero? Say whether the question is optimizing the wrong variable.
```

**Expansionist**
```
Hunt for upside that is being missed. What could be bigger? What adjacent opportunity sits right next to this that nobody mentioned? What cheap experiment would test it? Stay grounded: tie every upside to something in the materials, and say what would have to be true for it to work.
```

**Outsider**
```
You have zero context about this person, their field, their history or their jargon. Respond only to what is literally in front of you. Say what you do not understand, what is assumed but never explained, and what a newcomer, customer or buyer would not get. Do not use outside knowledge of this project. Treat every unexplained term as unexplained.
```

**Executor**
```
You care about one thing: what happens on Monday morning. For each recommendation, give the first concrete action, what it needs, how long it takes, and how you would know it worked. If an idea has no clear first step, say so plainly. End with a sequenced plan for the next one to two weeks and the one thing you would deliberately not do yet.
```

### 6.3 Project-review coverage checklist (add when `project_review` is on)
Append to every advisor's prompt:

```
This is a whole-project review. Beyond your style, cover each area below. For each area give specific issues with evidence, or write "no view" if you genuinely have none. Do not skip an area silently.
Areas: architecture and design; correctness and testing; security and trust model (enumerate how it can be bypassed and what the real guarantee is); operations and reliability; product and first-use experience; research or evidence validity (what is measured, what is not, is the sample size enough); commercial viability (buyer, budget, competitors, distribution); legal and compliance (claims, licensing, privacy); and what is missing from the materials entirely.
```

### 6.4 Reviewer prompt

```
You are a reviewer on a council. Below is a question and five anonymous responses (A to E) from different advisors. You do not know who wrote what.

Question:
{framed_question}

Responses:

{responses_text}

Answer exactly these three questions, in this order, in plain text:

1. Which response is the strongest, and why? Cite specific points.
2. Which response has the biggest blind spot? Name the response and the blind spot.
3. What did ALL FIVE responses miss? Be specific. Do not repeat anything any response already said. If nothing material was missed, say so and explain why.

Then, at the very end, give a final ranking from best to worst in exactly this format:

FINAL RANKING:
1. Response X
2. Response Y
3. Response Z
4. Response V
5. Response W

Do not add any text after the ranking.
```

### 6.5 Chairman prompt

```
You are the Chairman of a council. Five advisors, each with a different thinking style, answered the question below independently. Five reviewers then read the anonymized answers, named the strongest and the biggest blind spot, and listed what all five missed.

Question:
{framed_question}

STAGE 1: Advisor responses (named by style):
{stage1_text}

STAGE 2: Reviews (the reviewers used anonymous labels; the mapping is given here):
{mapping}

{stage2_text}

Write the council's final answer. Rules:
- Do not invent evidence. Keep the [FACT] / [MATERIALS] / [INFERENCE] / [OPINION] tags and mark anything unverifiable.
- Preserve minority views and say who held them. Do not average disagreement away.
- Give special weight to what reviewers said all five missed.
- Be direct. No flattery, no hedging for politeness.

Use exactly this structure:

VERDICT: <one line>
CONFIDENCE: High | Medium | Low, and why
WHERE THE COUNCIL AGREED:
WHERE IT SPLIT (keep dissent):
WHAT PEER REVIEW CAUGHT THAT NO ADVISOR SAID:
KEY RISKS AND UNKNOWNS:
RECOMMENDATION:
ONE CONCRETE NEXT STEP: <a single action doable within one working day, plus the check that tells you it worked>
WHAT WOULD CHANGE THIS VERDICT:

If this is a whole-project review, also add an ISSUE REGISTER table with columns:
ID | Severity (Critical/High/Medium/Low) | Issue | Evidence (file or section, or "advisor claim, unverified") | Fix | Done when | Raised by
```

### 6.6 Focus lenses (append to every advisor prompt when `focus` is on)

The five personas give different *ways of thinking*. They do not guarantee that a product question gets looked at through a product lens, or a performance question through a performance lens. These lenses do that, without turning into a checklist that flattens the personas — each advisor still answers in its own style, and a lens only says "make sure your style has something to say about this".

Turn lenses on with `auto` when the question is about a built product and the user asked "where can we improve / how do we compare". A caller may force a list. Give each advisor **at most two lenses** — its own style is the first lens, so adding all of them at once produces five people saying the same things.

Append this block, with `{lenses}` replaced by the selected lens texts:

```
Beyond your thinking style, apply these lenses. For each, say what is genuinely true for THIS project at ITS scale — or write "no view" if you have none. Do not pad.

{lenses}

For every lens, separate what a large comparable does from what this project's actual scale can justify. A mechanism that is correct at 100,000 orders a day can be actively harmful at ten. State the scale you are assuming.
```

The lens texts:

**UX / storefront** — "Judge the first-use experience as a person who may not read well and is on a cheap phone in patchy coverage: what is the first screen, how many taps to the first successful action, what does the screen say when it is loading, empty, or broken, and where does the customer have to read a number to trust it. Name a specific screen or flow that is weakest and say what you would change first."

**Performance / latency** — "Look at the actual round trips: how many network calls a cold start makes, what is fetched and re-fetched, what is cached and for how long, and which of those calls sit on the critical path before the customer can act. Distinguish server time from network time from render time. Name the single change with the largest effect on time-to-first-useful-screen."

**Scale / concurrency** — "Take the platform's published limits (connections, messages per second, row counts, function timeouts) and the project's own fan-out — how many clients hear about one write. Say where it breaks first as load grows, at what number, and whether that is inside or outside the project's realistic next two years. Prefer the boring fix (fewer subscribers, smaller payloads, an index, a partial index) over an exciting one."

**Cost** — "Estimate the running cost of the current design at the pilot scale and at ten and a hundred times it, using real unit prices, and say which line item dominates. Flag anything paid per request or per byte that the design calls on a hot path."

**Trust, privacy and safety** — "Enumerate who can see each piece of data, what a leaked device exposes, and what a malicious or merely buggy client could cause. Check the family/shared-phone case and the lost-phone case explicitly, and say whether the guarantee is enforced in the database or only in the app."

**Tracking and live state** — "For anything that shows a live position, status or countdown: where does the number come from, how stale can it be before it lies, what happens when the update stream drops, and what the screen shows in the gap. Say whether the value is computed on the server or inferred on the client, and whether a user could ever see two contradictory versions of it."

**Operations** — "Say who is on the phone at 9 p.m. when this breaks, what they will actually see, and what one action recovers it. Name the thing that has no runbook and should."

**Accessibility and language** — "For the users this is built for: is the meaning carried without reading, are tap targets and contrast sufficient in both themes, does the second language read as native rather than translated, and does anything assume a literacy or a device the users do not have."

**Commercial / moat** — "Is this feature something the shop's customers will actually pay for or return for, or is it engineering for its own sake? Say what evidence would show it earned its keep, and what to cut instead."

### 6.7 Focus lens auto-selection

`auto` picks lenses from the question's wording and the materials, and records the choice in the run notes. Rough map — treat as a hint, not a law:

| The question mentions… | Add lenses |
|---|---|
| look, design, screen, UI, first impression, "how it compares" | UX, accessibility and language |
| speed, refresh, lag, time to first screen, "feels slow" | Performance, Cost |
| scale, load, concurrency, "many users", hit rate, throughput | Scale, Performance |
| driver/rider location, map, ETA, route, "where is my order" | Tracking, Trust and privacy, Performance |
| privacy, data, shared phone, deletion, "who can see" | Trust and privacy, Accessibility and language |
| price, plan, bill, "is it worth it" | Cost, Commercial |

If no row matches, add none and say so.

## 7. Parsing and aggregation

- Parse each review after the first `FINAL RANKING:`: take lines matching `digits. Response <capital letter>`, in order. If none match, take every `Response <letter>` after the marker, in order. If there is no marker, take every `Response <letter>` in the whole text, in order. Record any fallback used.
- Aggregate: for each response, average its position across all parsed rankings (self-votes included, as in the original method) and count votes. Lower is better.
- Also tally: how many reviewers named each response strongest, and each biggest blind spot.
- Rankings are advisory. Never present the aggregate as proof; the arguments matter more than the votes.
- After aggregation, reveal the mapping in the report.

## 8. Output

### 8.1 Files
Create `.council/runs/<YYYYMMDD-HHMM>-<short-slug>/` containing:

```
framed-question.md
benchmarks.md                       (Step 0.5, only when benchmark is on)
advisors/<style>.md                 (5 files)
reviews/reviewer-<1-5>.md           (raw text + parsed ranking)
mapping.json
aggregate.md                        (ranking table, strongest and blind-spot tallies)
chairman.md
verification.md                     (section 5, step 6)
transcript.md                       (everything above in reading order)
report.html                         (single self-contained file, no external requests)
```

### 8.2 report.html
Self-contained, light and dark mode via CSS variables, readable on a phone, scannable in 60 seconds. Top to bottom: verdict card (verdict, confidence, one next step); issue register (project reviews); where the council agreed and split; "what all five missed"; the benchmark table (`benchmarks.md`: comparable, mechanism, source, this project at its scale) when the step ran; five advisor cards with anonymous letter badges and style revealed; a review matrix (rows reviewers, columns strongest, blind spot, ranking); aggregate table; verification results; limits and run notes (mode, models, focus lenses used, benchmark on/off, dropped members, simulation flag). No remote fonts, scripts or images.

### 8.3 Chat summary
At most 150 words: the verdict line, confidence, the one concrete next step, the path to `report.html` and `transcript.md`, and run notes (dropped members, simulation or not, estimated tokens). Offer the full raw outputs of any stage.

## 9. Modes

- **styles** (default): five thinking styles, ideally on different models if several are configured.
- **models** (Karpathy original): three to five different models answer the same plain question with no persona; stages 3 to 5 are identical. The reviewer prompt in 6.4 works unchanged. Use the chairman from the strongest model.
- **both**: styles, each style assigned a different model. Most diversity.

If only one model is available, say that disagreement will be smaller. Do not pretend otherwise.

## 10. Failure handling and cost

- Advisor fails: retry once, then drop; continue with three or more. Fewer than three: stop and say so.
- Reviewer fails: drop it and note it. Chairman fails: retry once, otherwise deliver raw stages.
- Context too large: cut materials to verbatim excerpts plus file paths and tell the user.
- Cost estimate: calls = 5 + 5 + 1 = 11. Input tokens are roughly `5*M + 5*(M+R) + (M+R+V)` where M is the framed question plus materials (including `benchmarks.md` when it ran), R the five advisor answers (about 2-3k) and V the five reviews (about 2-3k). Show the estimate before running when M exceeds about 15k tokens, and offer: `quick` depth, a cheaper model for advisors and reviewers with the strongest model only as chairman, or narrowing the question to one fork.
- Benchmark fetch fails (no web access, no published source): write `benchmarks.md` saying so, and mark every comparable claim the advisors make `[INFERENCE]` or `[OPINION]`, never `[FACT]`. Do not let an invented comparable reach the report.
- Focus lens makes advisors pad: a lens that produced "no view" from an advisor is a fine answer; do not re-run to force content.

## 11. Quality checklist before delivering

- [ ] Framed question had no conclusions or loaded wording
- [ ] If `benchmark` was on, `benchmarks.md` holds fetched `[FACT]`s with sources and the scale gap, and the framed question stayed factual
- [ ] If `focus` was on, each advisor got at most two lenses beyond its own style, and the lenses chosen are recorded
- [ ] Every role ran in a fresh isolated context (or the report is marked SIMULATION)
- [ ] Letters were shuffled with real randomness; mapping saved; reviewers never saw it
- [ ] No votes or answers were written by the orchestrator
- [ ] Rankings parsed from actual output; fallbacks and drops recorded
- [ ] Chairman's checkable claims were spot-checked
- [ ] The verdict ends in exactly one concrete next step
- [ ] Unverified items are labelled as such

## 12. Lessons from a prior single-model simulation (do not repeat)

An earlier council was written entirely by one model in one pass. Problems to avoid:
1. The framed question listed "what is not built" and quoted the claim under review, which leaked conclusions into the question.
2. Advisors were written after the author had already formed a view, so their agreement was an echo.
3. The rankings and tally were authored, not collected, so they carried no information.
4. Some of the "all five missed" items were the author's own additions, not discoveries.
5. The arguments were still checkable against the materials; judge by evidence, not votes.

## 13. OpenCode implementation notes (illustrative; verify against the current OpenCode docs)

- **Skill location:** `.opencode/skills/council/SKILL.md` (project) or `~/.config/opencode/skills/council/SKILL.md` (global). The directory name must equal `name`; `description` must be 1-1024 characters. The skill is loaded with OpenCode's `skill` tool.
- **Subagents:** define `council-advisor`, `council-reviewer` and `council-chairman` as subagents in `.opencode/agents/` with read-only permissions (no edit, no write-capable bash). Set a different `model` per subagent when you want model diversity.
- **Parallelism:** issue all five advisor tasks in one assistant message, then all five reviewer tasks in one message. If parallel subagents are not available, run each role as a separate fresh session (for example one non-interactive CLI invocation per role) so contexts stay isolated; never reuse a session between roles.
- **Slash command (optional):** `.opencode/commands/council.md` with a short description and a template that says: load the `council` skill and run it on `$ARGUMENTS`.
- **Randomness and files:** use a small script or one-liner for the shuffle and for assembling `responses_text`, so you do not do it by hand.
- Illustrative subagent frontmatter (key names may differ in the current version):

```
---
description: Council advisor. Answers one framed question from one assigned thinking style. Read-only.
mode: subagent
model: <provider/model>
permission:
  edit: deny
  bash: deny
---
Follow the prompt you are given exactly. Do not ask questions. Do not use any context except what is in the prompt and files you are told to read.
```

## 14. Honest limits

- A council of copies of one model disagrees less than a council of different models. Use `models` or `both` when several providers are configured.
- Agreement is not truth. The council improves coverage and exposes blind spots; it does not verify facts. Spot-check (section 5, step 6) matters.
- Reviewer rankings are noisy. Treat them as a signal about which arguments held up, not as a vote count that decides.
- The method works best on one clear decision with real materials. Vague questions give vague councils.
