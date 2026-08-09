# Canyon Charms Clarity and Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first minute of Canyon Charms self-explanatory and make one command verify every repository deliverable.

**Architecture:** Keep deterministic game rules untouched. Add semantic onboarding in HTML, a separate clarity-only stylesheet, a compositional verification script, static contract tests, and a current-branch Chrome smoke step in CI.

**Tech Stack:** JavaScript ES modules, HTML, CSS, Node.js 22 built-ins, `node:test`, GitHub Actions, headless Chrome.

## Global Constraints

- Runtime dependencies remain zero.
- Do not change game scoring, match resolution, seeds, moves, target, persistence, or publisher events.
- Do not copy Wild West Match 2 code, branding, art, audio, layout, or level data.
- The public preview must not be claimed updated until its exact merged commit passes the immutable Chrome workflow.
- GitHub Pages and Arkadium publication claims remain fail-closed.

---

### Task 1: Define the clarity contract

**Files:**
- Create: `test/clarity-contract.test.js`

**Interfaces:**
- Consumes: repository files as UTF-8 text.
- Produces: five Node tests that fail when onboarding, verification, CI evidence, or Russian instructions are missing.

- [ ] **Step 1: Add tests for title recipes and level goal.**
- [ ] **Step 2: Add tests for hint and invalid-swap explanations.**
- [ ] **Step 3: Add tests for `npm run verify`, CI Chrome boot, and `START_HERE_RU.md`.**
- [ ] **Step 4: Run `node --test test/clarity-contract.test.js`.**
- [ ] **Step 5: Confirm RED because the new surfaces do not yet exist.**
- [ ] **Step 6: Commit with `test: define Canyon Charms clarity contract`.**

### Task 2: Improve the first-minute game explanation

**Files:**
- Modify: `example/canyon-charms/index.html`
- Create: `example/canyon-charms/clarity.css`

**Interfaces:**
- Consumes: existing `data-action` buttons and existing visual CSS variables.
- Produces: semantic goal ribbon, three recipe cards, a playfield reminder, and expanded help content.

- [ ] **Step 1: Link `clarity.css` after `styles.css`.**
- [ ] **Step 2: Add the 5,000-point / 20-move goal ribbon.**
- [ ] **Step 3: Add labeled match-3, match-4, and match-5/T/L cards.**
- [ ] **Step 4: Add the non-blocking playfield reminder and automatic-hint copy.**
- [ ] **Step 5: Expand the help dialog with recipes, invalid-swap behavior, and controls.**
- [ ] **Step 6: Add responsive CSS for desktop, phone, short landscape, and reduced motion.**
- [ ] **Step 7: Run `node --test test/clarity-contract.test.js` and expect the game-copy tests to pass.**
- [ ] **Step 8: Commit with `feat(game): clarify Canyon Charms onboarding`.**

### Task 3: Add one complete local verification command

**Files:**
- Create: `scripts/verify.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing test, check, package, serve, and handbook commands.
- Produces: `npm run verify`, two ZIPs, a PDF, a build report, current-branch DOM evidence, and a Chrome screenshot.

- [ ] **Step 1: Implement `scripts/verify.mjs` as a fail-fast sequence.**
- [ ] **Step 2: Add `"verify": "node scripts/verify.mjs"` to `package.json`.**
- [ ] **Step 3: Change CI to run `npm run verify`.**
- [ ] **Step 4: Serve `example/canyon-charms/dist` and boot it in headless Chrome.**
- [ ] **Step 5: Assert the dynamic Canvas description, reduced-motion state, clarity copy, and hidden boot-error surface.**
- [ ] **Step 6: Upload both ZIPs, the PDF, build report, screenshot, DOM, and Chrome log.**
- [ ] **Step 7: Run `node --test test/clarity-contract.test.js` and `node --check scripts/verify.mjs`.**
- [ ] **Step 8: Commit with `ci: verify the complete game candidate`.**

### Task 4: Make the repository easy to enter

**Files:**
- Modify: `README.md`
- Create: `docs/START_HERE_RU.md`
- Create: `docs/superpowers/specs/2026-08-09-canyon-charms-clarity-quality-design.md`
- Create: `docs/superpowers/plans/2026-08-09-canyon-charms-clarity-quality.md`

**Interfaces:**
- Consumes: the verified command surface and honest deployment status.
- Produces: one concise English repository entrypoint and one Russian student path.

- [ ] **Step 1: Put `npm run verify` at the center of the quick start.**
- [ ] **Step 2: Add a repository status table and map.**
- [ ] **Step 3: Add the Russian start-here guide with game rules and exact commands.**
- [ ] **Step 4: Preserve explicit GitHub Pages and Arkadium blockers.**
- [ ] **Step 5: Run `node --test test/clarity-contract.test.js`.**
- [ ] **Step 6: Commit with `docs: add a clear student entrypoint`.**

### Task 5: Review, merge, and repin the public preview

**Files:**
- Review all changed files.
- Follow-up modify: `README.md`
- Follow-up modify: `docs/CANYON_CHARMS_DELIVERY.md`
- Follow-up modify: `.github/workflows/public-preview-smoke.yml`

**Interfaces:**
- Consumes: the first PR's exact squash-merge SHA.
- Produces: an immutable URL whose HTML, CSS, modules, dynamic state, and screenshot are verified at that SHA.

- [ ] **Step 1: Run the full PR CI and require both verification and browser evidence to pass.**
- [ ] **Step 2: Review changed-file scope and confirm no game-rule files changed.**
- [ ] **Step 3: Squash-merge the clarity/quality PR.**
- [ ] **Step 4: Create a follow-up branch from the new `main`.**
- [ ] **Step 5: Replace the old preview SHA in README, delivery docs, and public-preview workflow.**
- [ ] **Step 6: Require the immutable Chrome workflow to pass.**
- [ ] **Step 7: Squash-merge the preview-pin PR.**
