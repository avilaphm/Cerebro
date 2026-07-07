# Help Me With My Next Meal

Single source of truth for the client-portal nutrition feature that turns a photo
of the fridge into meal ideas that fit the client's remaining macros. Read this
before touching any `NextMeal*` code, `detect-fridge-ingredients`, or the Phase 2
generation work.

- **Owner:** Pedro Avila
- **Surface:** client portal → Nutrition tab (`/client`)
- **PRD:** Google Doc "Help Me With My Next Meal" (Pedro's). This doc is the
  engineering source of truth and supersedes the PRD where they differ.
- **Status:** Phase 1 (detection + confirmation) **shipped**. Phase 2 (generation)
  is next. Phase 3 (recipe book) after that.

Status legend: ✅ done · 🔜 next · ⏳ later · ⚠️ decision/limitation

---

## 1. Why we're building it (the problem)

Clients track meals **reactively** - they log what they already ate. The real
daily friction is standing in front of the fridge with no idea what to cook that
still fits their plan. Generic recipe apps don't know the client's calorie target,
what they've already eaten today, what they're allergic to, or what's actually in
their fridge.

**The insight that makes this cheap to build:** everything the AI needs to "know
the client" already exists in the database (see §4). We are not building a new
nutrition brain - we are pointing the AI at data we already have and adding a
fridge-photo input.

---

## 2. What it is (the big picture)

A proactive flow: **pick the meal → photograph the fridge → confirm ingredients →
get 5 meal options that fit your remaining macros → cook it / save it / log it.**

Two generation modes (Phase 2):
- **Discovery** (no craving): 5 diverse options from confirmed ingredients.
- **Craving** ("protein pancakes"): option 1 is the exact craving built from what
  they have (macro-adjusted), options 2-3 variations, 4-5 the AI's own picks.
  Never invents missing ingredients - substitutes and says so.

⚠️ **First-meal-of-the-day behaviour (Pedro's decision: "full remaining + teach").**
When nothing is logged yet, "remaining macros" = the whole day's target. The AI
must NOT dump the full day into one meal. Instead it shows the full day's budget as
context, picks a sensible single-meal portion, and teaches: *"this ~550 kcal / 45g
protein breakfast leaves ~1,450 kcal / 105g protein for the rest of today."* This
is distinct from **gap-fill mode** (client has tracked, small remainder before bed
→ fill the exact gap with lighter options). Detecting which mode is free: check
whether anything is logged today.

---

## 3. Roadmap (phases + status)

| Phase | Scope | Status |
| --- | --- | --- |
| **1. Detection & confirmation** | Entry point, meal-type step, in-app camera capture, AI ingredient detection, confirmation (chips, add, staples, craving, yes/no cards) | ✅ shipped |
| **2. Generation & logging** | Generation edge function (full context payload + modes), 5 option cards, "I made this" → tracker, single-card regen, craving re-ask | 🔜 next |
| **3. Recipe book & memory** | `recipes` table, Recipe Book tab (grid/list, search, filter, save/remove, "I made this"), generation-session memory | ⏳ later |

---

## 4. How it's wired (the connected data model)

The whole point is that **it's all connected**. Every AI input reads existing data;
only Phase 3 adds new tables.

| The AI needs | Where it lives today | Notes |
| --- | --- | --- |
| Calorie + macro **target** | `pt_client_nutrition_doc.daily_targets` (jsonb: calories, protein_g, carbs_g, fat_g, fibre_g) | Set by the coach / nutrition programme |
| What they've eaten **today** | `pt_nutrition_logs` (per meal, macro'd) | `NutritionTab` already sums this into `totals` |
| **Remaining** macros | derived: `target − sum(today's logs)` | one-line computation |
| **Allergies / foods to avoid / dislikes** | `pt_client_nutrition_doc.foods_to_avoid` | plus `favourite_foods`, `typical_meals`, `eating_habits`, `recurring_gaps` |
| **Goal** | `pt_clients.goals` (+ `pt_phase_nutrition`, `pt_client_nutrition_doc.phase_nutrition_strategy`) | fat loss / muscle / performance / health |
| **Recent meals** (avoid repeats) | `pt_nutrition_logs`, last 2-3 days | |
| **Vision** (photo → items / macros) | reuse the `log-nutrition-batch` Claude pipeline | model `claude-sonnet-4-6` |

**New persistence - Phase 3 only:** a `recipes` table (recipe book) and a small
generation-session memory table.

---

## 5. How it works (architecture & files)

### Flow
```
Nutrition tab
  ├─ "Track your food"            → NutritionChatModal   (existing food logger)
  └─ "Help me with my next meal"  → NextMealModal        (this feature)
        meal type → capture (in-app camera / library)
          → detect-fridge-ingredients (Claude vision)
            → confirm (yes/no cards + chips + add + staples + craving)
              → [Phase 2] generate → 5 options → I made this / save / regen
```

### Files
| File | Role |
| --- | --- |
| `app/client/NutritionTab.tsx` | Entry point - two equal-weight buttons; renders `NextMealModal` |
| `app/client/NextMealModal.tsx` | The whole Phase 1 flow (meal type → camera → analyze → confirm → interim done) |
| `supabase/functions/detect-fridge-ingredients/index.ts` | Vision edge function; returns `{ ok, ingredients:[{name,category,confidence}] }` |
| `app/client/NutritionChatModal.tsx` | (Reference) existing food logger - camera/voice/compression patterns were ported from here |
| `supabase/functions/log-nutrition-batch/index.ts` | (Reference) existing vision + auth + CORS pattern the edge function mirrors |
| `supabase/functions/generate-nutrition-programme/index.ts` | (Reference) the admin-OR-owner `authorizeClient` pattern used for auth |

### Authorization (learned the hard way - see §7)
`detect-fridge-ingredients` authorizes if the caller is **coach/admin**
(`PEDRO_EMAILS` or `profiles.role='admin'`) **OR the owning client**
(`pt_clients.user_id = auth.uid`). Owner-only 404s whenever Pedro (or any coach)
tests from a non-client login. Expected auth/parse failures return HTTP 200
`{ok:false,error}` so the real reason reaches the UI.

### In-app camera (multi-shot)
Native `<input capture>` forces take → "Use Photo" → reopen per shot. Instead we
use `getUserMedia({ video: { facingMode:{ideal:'environment'} } })` with a live
`<video autoPlay playsInline muted>` preview and a shutter that draws frames to a
canvas → jpeg. Snap many in a row, up to **10**. Falls back to the native input if
getUserMedia is unavailable/denied. (MDN "still photos with getUserMedia"; mirrors
the ML-assessment / Studio cameras already in the repo.)

---

## 6. What's done (Phase 1, in detail) ✅

- Entry point: single "Track your food" button split into two equal-weight actions.
- `NextMealModal` flow:
  - Meal type: breakfast / lunch / dinner / snack.
  - Capture: in-app multi-shot camera (up to 10) + "Choose from library"
    (multi-select) + native fallback; deletable thumbnails; running count.
  - Analyze: calls `detect-fridge-ingredients`.
  - Confirm: **yes/no "Just checking" cards** for low-confidence detections
    (Yes → confirmed chip, No → removed); high-confidence items go straight to
    category-grouped chips; add-via-text with a small hardcoded autocomplete;
    "I have basic staples" toggle (default ON); optional craving field with
    iOS-safe voice-to-text.
- `detect-fridge-ingredients` edge function: deployed (v2, `verify_jwt` on),
  admin-OR-owner auth, strict JSON output, dedupe, category normalisation.
- ⚠️ Phase 1 ends at an **honest interim** screen ("got your ingredients,
  suggestions coming shortly") because generation is Phase 2.

**Verified:** tsc + production build pass; camera overlay (shutter, thumbnails,
count, Done) and confirm yes/no cards visually confirmed at 390px via a throwaway
probe + Playwright (getUserMedia stubbed with a canvas stream, detection stubbed).

---

## 7. Decisions & lessons locked in

- ⚠️ **First-meal-of-day = "full remaining + teach"** (not per-meal-type split, not
  ask-how-many-meals). Shapes the Phase 2 generation prompt.
- ⚠️ **Auth = admin-OR-owner**, never owner-only, for any client-scoped tool a coach
  might also invoke. Owner-only is why the first build 404'd for Pedro.
- ⚠️ **Never hard-code a presumed error cause.** The first build always showed
  "couldn't read the photos" - the real failure was a 404 auth mismatch. Surface
  the server's real reason.
- **Reuse over invention:** vision/auth/CORS from `log-nutrition-batch`; camera +
  voice + compression from `NutritionChatModal`; auth pattern from
  `generate-nutrition-programme`.
- Full engineering post-mortems: `session-logs/learning-log.md` entries 079 & 080.

---

## 8. What's next 🔜

### Phase 2 - generation & logging
- **New edge function** (e.g. `suggest-next-meal`) mirroring the vision/auth
  pattern. Context payload: confirmed ingredients + staples flag, meal type,
  **remaining macros** (target − today's logs), goal, `foods_to_avoid`, last 2-3
  days of meals, and the **full-day-vs-gap-fill mode** flag.
- Output contract: exactly 5 meals - `{ name, description, whyThisOne,
  prepTimeMinutes, calories, protein, carbs, fat, ingredients[], steps[] }`.
- Rules: only confirmed ingredients + staples; ≥1 option under 15 min; macros
  labelled as estimates; craving mode + substitution honesty; discovery mode.
- UI: 5 option cards (name, description, macros, prep time, "why this one",
  tap-to-expand recipe); **"I made this"** → insert into `pt_nutrition_logs`
  (reuse the existing log shape); single-card **regenerate**; craving re-ask.
- Wire `NextMealModal`'s "Find meals" CTA from the interim screen to this.

### Phase 3 - recipe book & memory ⏳
- `recipes` table: `id, client_id, name, description, meal_type, calories, protein,
  carbs, fat, prep_time, ingredients (jsonb), steps (jsonb), source, created_at`.
- Recipe Book tab in Nutrition: grid/list, search, meal-type filter, save
  (idempotent), remove, "I made this".
- Generation-session memory table (meal type, confirmed ingredients, chosen
  option) - stored in v1, used as a personalization signal later.

### Known gaps / open items ⚠️
- iOS Safari `getUserMedia` needs **real-device testing on Pedro's phone** - the
  only true test of the in-app camera.
- Autocomplete uses a small hardcoded ingredient list (fine for v1).
- The "Help me with my next meal" button is **live to clients**; until Phase 2 it
  ends at the interim screen. Gate/hide it in `NutritionTab` if clients shouldn't
  see an in-progress feature yet (one-line change).
- Allergy safety currently relies on `foods_to_avoid` being passed to the model in
  Phase 2 - verify it's honoured before relying on it for hard allergies.
