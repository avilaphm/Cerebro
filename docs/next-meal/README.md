# Help Me With My Next Meal

Single source of truth for the client-portal nutrition feature that turns a photo
of the fridge into meal ideas that fit the client's remaining macros. Read this
before touching any `NextMeal*` code, `detect-fridge-ingredients`, or the Phase 2
generation work.

- **Owner:** Pedro Avila
- **Surface:** client portal → Nutrition tab (`/client`)
- **PRD:** Google Doc "Help Me With My Next Meal" (Pedro's). This doc is the
  engineering source of truth and supersedes the PRD where they differ.
- **Status:** All three phases **shipped** (detection + confirmation, generation +
  logging, recipe book + session memory). The build is feature-complete; remaining
  items are a real-device pass and optional v2 ideas (see §8).

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
| **2. Generation & logging** | Generation edge function (full context payload + modes), 5 option cards, "I made this" → tracker, single-card regen, craving re-ask | ✅ shipped |
| **3. Recipe book & memory** | `recipes` table, Recipe Book (search, filter, save/remove, "I made this"), generation-session memory | ✅ shipped |

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

**New persistence (Phase 3, shipped):**
- `recipes` - saved recipe book rows: `id, client_id, name, description, meal_type,
  calories, protein, carbs, fat, prep_time, ingredients (jsonb), steps (jsonb),
  source, created_at`. RLS: admin-full + client owns own (insert/read/delete),
  mirrors `pt_nutrition_logs`.
- `next_meal_sessions` - generation-session memory: `id, client_id, meal_type,
  ingredients (jsonb), craving, chosen_option (jsonb), created_at`. Inserted on
  each generation; `chosen_option` set when the client logs/saves an option.
  v1 stores only (personalization signal for later). Same RLS pattern.

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
              → suggest-next-meal (Claude) → 5 options
                → expand recipe / Swap (regen one) / craving re-ask
                → "I made this" → pt_nutrition_logs → tracker refreshes
```

### Files
| File | Role |
| --- | --- |
| `app/client/NutritionTab.tsx` | Entry point - two equal-weight buttons; renders `NextMealModal` |
| `app/client/NextMealModal.tsx` | The whole flow (meal type → camera → analyze → confirm → options → logged); Save-to-book bookmark + session memory |
| `app/client/RecipeBookModal.tsx` | Recipe Book: load, search, meal-type filter, expandable cards, "I made this" + "Remove", empty state |
| `supabase/functions/detect-fridge-ingredients/index.ts` | Vision edge function; returns `{ ok, ingredients:[{name,category,confidence}] }` |
| `supabase/functions/suggest-next-meal/index.ts` | Generation edge function; loads targets/remaining/foods_to_avoid, returns 5 meals + context |
| migration `next_meal_recipe_book` | Creates `recipes` + `next_meal_sessions` tables and their RLS |
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

### Phase 2 (generation + logging) ✅
- `suggest-next-meal` edge function (deployed, `verify_jwt` on): loads
  `daily_targets`, sums today's `pt_nutrition_logs` → **remaining**, reads goal +
  `foods_to_avoid` + last 3 days of meals, detects **full_day vs gap_fill** mode,
  and returns exactly N meals (`{name, description, whyThisOne, prepTimeMinutes,
  calories, protein, carbs, fat, ingredients[], steps[]}`) + a `context`
  (mode + remaining). Discovery + craving modes; substitution honesty.
- Options step in `NextMealModal`: context banner (mode-aware remaining), 5 cards
  (name, macros, prep time, "why this one"), tap-to-expand recipe (ingredients +
  steps), **"I made this"** → direct insert into `pt_nutrition_logs` (input_type
  `text`) → `onLogged` refreshes the tracker → logged-success screen, **"Swap"**
  (single-card regen, `count:1` + `exclude` current names), and a **craving
  re-ask** ("New options" regenerates all 5 excluding the current set).

### Phase 3 (recipe book + session memory) ✅
- Migration `next_meal_recipe_book`: `recipes` + `next_meal_sessions` tables + RLS.
- **Save** bookmark on each option card in `NextMealModal` → insert into `recipes`
  (source `generated`); idempotent per session (a `savedNames` set + filled/disabled
  bookmark state).
- **`RecipeBookModal`** (opened from a "Recipe book" button under the two nutrition
  actions): loads the client's recipes, search (name/description/ingredient),
  meal-type filter chips, expandable cards, **"I made this"** → `pt_nutrition_logs`
  (refreshes tracker), **"Remove"** → delete row. Friendly empty state with a
  "Find a meal" button that opens the flow.
- **Session memory:** each generation inserts a `next_meal_sessions` row
  (meal_type, ingredients, craving); `chosen_option` is set when the client logs or
  saves an option. Stored only in v1.

**Verified:** tsc + production build pass. Whole flow (meal type → in-app camera →
analyze → confirm yes/no cards → 5 options → expand recipe → Save bookmark → "I made
this") and the Recipe Book (load, "3 saved", search, meal-type filter, expand,
I-made-this/Remove) confirmed at 390px via a throwaway probe + Playwright, with
getUserMedia (canvas stream) and the network calls stubbed.

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
- Full engineering post-mortems: `session-logs/learning-log.md` entries 079, 080,
  082, 083.

---

## 8. Feature complete + what's next 🔜

All three phases are shipped. The remaining work is a real-device pass and
optional v2 polish.

### Must do before relying on it ⚠️
- **Real-device pass on Pedro's phone**, logged in as the actual client: iOS
  Safari `getUserMedia` (the in-app camera) and a live detect → generate →
  Save/"I made this" round trip. Everything was verified with a stubbed probe, not
  a real client session end to end.
- **Allergy safety** relies on `foods_to_avoid` being passed to `suggest-next-meal`
  (it is, with a "NEVER include" instruction). Spot-check it holds for a client
  with a real allergy before trusting it for hard allergies.
- The feature is **live to clients**. Gate/hide the two buttons in `NutritionTab`
  if it shouldn't be visible yet.

### Optional v2 ideas ⏳
- Use `next_meal_sessions` as a personalization signal (v1 only stores it).
- Autocomplete from a real ingredient source instead of the hardcoded list.
- De-dupe recipe saves across sessions (currently idempotent per session only).
- "I made this" from a recipe could deduct/scale portions; today it logs the
  recipe's stored per-serving macros as-is.
