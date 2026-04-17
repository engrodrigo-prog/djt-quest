# DJT Quest Strategic Opportunities

**Document**: Strategic roadmap for product, technical, and business improvements  
**Date Generated**: April 15, 2026  
**Codebase Size**: 350+ TS/TSX files, 75+ API handlers, 90+ SQL migrations  
**Current Status**: Fully functional enterprise platform with security hardening (R1-R6 completed)

---

## Executive Summary

DJT Quest is a sophisticated gamified learning platform with strong foundations in authentication, database architecture, and AI integration. This document identifies 30+ concrete opportunities across seven strategic categories, prioritized by impact and effort.

**Key Findings**:
- Performance: Bundle size optimization, caching gaps, API timeout management
- AI: Underutilized Claude/Anthropic, missing prompt engineering, vendor lock-in to OpenAI
- Product: Missing analytics dashboard, offline-first PWA, real-time leaderboards, advanced reporting
- Quality: 76 TypeScript strictness issues, no test coverage, 1,127 console references
- Security: Recent RLS hardening (completed), LGPD audit gaps, encryption at rest needed
- Infrastructure: Single Vercel plan, no distributed caching, missing observability
- Business: CPFL ecosystem integration, predictive analytics, competitive gamification features

---

# 1. PERFORMANCE & SCALABILITY

### [OP-01] Frontend Bundle Optimization via Code Splitting
**Category:** Performance & Scalability  
**Impact:** Medium  
**Effort:** Medium  
**Priority Score:** 7

**Current state**: Vendor chunking exists (vendor-react, vendor-ui, vendor-data, vendor-forms, vendor-maps, vendor-charts, vendor-dates, vendor-misc) but React Router lazy loading not fully utilized. Components are 70+ files, not all lazy-loaded.

**Opportunity**: Implement granular lazy-loading for feature routes (Forum, SEPBook, Study, Challenges, Evaluations, Studio). Current Dashboard.tsx loads all role-based options upfront.

**Business value**: Reduce initial bundle by 30-40%, improve Core Web Vitals (LCP, FID), faster Time-to-Interactive on slower networks.

**Technical approach**:
- Use `React.lazy()` for page components already in place; extend to sub-routes
- Implement route-based prefetching on hover via `useTransition()`
- Split vendor-misc (largest) into vendor-maps, vendor-charts more aggressively
- Add dynamic imports for heavy modals (AttachmentUploader, ChallengeManagement)

**Dependencies**: Vite v7.3.1 already supports; no breaking changes needed.

---

### [OP-02] Implement Request-Level Caching & Revalidation Strategy
**Category:** Performance & Scalability  
**Impact:** High  
**Effort:** Medium  
**Priority Score:** 9

**Current state**: TanStack Query v5.90.21 configured but cache defaults not optimal. Session cache exists (5-min TTL for auth) but quiz attempts, rankings, forum posts lack SWR strategy.

**Opportunity**: Add stale-while-revalidate (SWR) pattern for read-heavy endpoints (rankings, study sources, forum topics). Implement background refetching for leaderboards.

**Business value**: Reduce API calls by 40%, improve perceived responsiveness (instant stale data + background refresh), reduce database load.

**Technical approach**:
- Configure TanStack Query with `staleTime: 2m, gcTime: 5m` for non-critical reads
- Add `useQuery({ refetchInterval: 30s })` for leaderboards (auto-updating)
- Implement background refetching on window focus (`refetchOnWindowFocus: true`)
- Add Cache-Control headers to API responses (public, max-age=120 for paginated data)

**Dependencies**: TanStack Query already supports; Vercel headers configured in vercel.json.

---

### [OP-03] Database Query Optimization: N+1 Elimination & Indexing
**Category:** Performance & Scalability  
**Impact:** High  
**Effort:** High  
**Priority Score:** 8

**Current state**: 90+ migrations exist with indexes, but query patterns in 75+ handlers not audited. Example: `quiz-practice-check` may fetch user, quiz, then all attempts sequentially.

**Opportunity**: Audit handlers for N+1 queries (e.g., fetch user, then per-item fetch of related data). Add missing EXPLAIN queries. Optimize expensive forum-post assessments (AI scoring on select).

**Business value**: 50%+ reduction in query latency, lower database CPU, better scaling for 1000+ concurrent users.

**Technical approach**:
- Profile top 10 handlers with Supabase query logs
- Use batch queries (`Promise.all`) in quiz-practice-check, forum-post, challenge-submit
- Add indexes on frequently-filtered columns: `forum_posts.topic_id`, `quiz_attempts.user_id`, `challenge_submissions.user_id`
- Implement connection pooling on Supabase (upgrade from Hobby plan)

**Dependencies**: Supabase Pro plan recommended; migrations can add indexes non-blocking.

---

### [OP-04] Implement Background Job Queue for Long-Running Tasks
**Category:** Performance & Scalability  
**Impact:** High  
**Effort:** High  
**Priority Score:** 7

**Current state**: AI operations (study-chat, quiz-generation, forum assessment) run synchronously in 60s Vercel timeout. STUDYLAB_OPENAI_TIMEOUT_MS=45000 + web search 12000 sometimes exceed limits.

**Opportunity**: Use Supabase edge functions + PgBoss or AWS SQS for async job processing. Quiz generation, forum assessment, study ingestion can queue and notify via webhooks.

**Business value**: Eliminate timeouts, improve user experience (show "processing" state), handle 10x more concurrent requests.

**Technical approach**:
- Move ai-study-chat ingest, forum-ai-assess-post to background jobs
- Use Supabase HTTP webhooks to notify frontend via Supabase Realtime
- Implement exponential backoff for retries (3 attempts max)
- Track job status in `background_jobs` table (status: pending, processing, completed, failed)

**Dependencies**: PgBoss (npm install), Supabase Realtime already enabled.

---

### [OP-05] Add Database Connection Pooling & Caching Layer
**Category:** Performance & Scalability  
**Impact:** High  
**Effort:** High  
**Priority Score:** 8

**Current state**: Direct Supabase connections per request. No Redis/Memcached. Auth session cache (5-min) is only caching mechanism.

**Opportunity**: Add Redis (Upstash or ElastiCache) for:
- Leaderboard scores (cache ranking queries)
- Forum topic metadata (CHAS, tags)
- Study source full-text search results
- User profile short-lived cache (1h)

**Business value**: 70% reduction in database queries, sub-50ms response times for cached data, cost savings.

**Technical approach**:
- Integrate `ioredis` or `@vercel/kv` (Vercel's Redis)
- Cache keys: `leaderboard:daily`, `forum:topic:{id}`, `study:fts:{query}`
- Set TTL: 5m for volatile (leaderboard), 1h for static (forum metadata)
- Invalidate on writes: POST/PUT/DELETE clear related keys

**Dependencies**: Upstash Redis (free tier 10k ops/day). `@vercel/kv` requires Vercel Pro.

---

# 2. AI & INTELLIGENCE

### [OP-06] Add Multi-Model AI Strategy (Claude, Gemini Fallback)
**Category:** AI & Intelligence  
**Impact:** High  
**Effort:** Medium  
**Priority Score:** 9

**Current state**: 100% OpenAI dependency (gpt-5-2025-08-07 for PREMIUM, gpt-5-nano for STUDYLAB). No fallback models. Environment-driven model switching exists but only within OpenAI ecosystem.

**Opportunity**: Add Anthropic Claude 3.5 Sonnet for quiz generation & study chat, Google Gemini for vision tasks. Implement model fallback chain: OpenAI (primary) → Claude (secondary) → Gemini (vision only).

**Business value**: 
- Cost reduction: Claude pricing more favorable for long-context (study ingestion)
- Vendor independence: reduce OpenAI API disruptions
- Better reasoning: Claude excels at structured output (quiz JSON)
- Competitive advantage: offer "choose your AI" feature to users

**Technical approach**:
- Add `OPENAI_MODEL_FALLBACK_PROVIDER` env var (claude|gemini)
- Refactor `ai-quiz-draft.ts` to try OpenAI, catch errors, retry with Claude
- Use Claude's native JSON mode for quiz parsing (no repair needed)
- Implement provider-agnostic prompt templates in `server/lib/ai-prompts/`
- Add telemetry: track which model succeeded, fallback rates

**Dependencies**: 
- Anthropic SDK `npm install @anthropic-ai/sdk`
- Google Generative AI `npm install @google/generative-ai`
- ~1 week refactoring

---

### [OP-07] Implement Prompt Engineering & Chain-of-Thought for Complex Tasks
**Category:** AI & Intelligence  
**Impact:** High  
**Effort:** Medium  
**Priority Score:** 8

**Current state**: System prompts are basic, single-turn. Example: `ai-quiz-draft` just says "Generate a question" without structure enforcement.

**Opportunity**: Implement few-shot prompting with examples. Add chain-of-thought for forum assessment (helpfulness, clarity, toxicity, CHAS) to improve consistency. Use structured output format (JSON schema enforcement).

**Business value**: 
- Improve quiz diversity & quality (fewer duplicates, better wrong answers)
- Reduce AI assessment variance (more consistent scoring)
- Faster inference: structured outputs prevent parsing/repair cycles

**Technical approach**:
- Create `/server/lib/prompts/quiz-generation.md` with few-shot examples
- Add few-shot to forum-ai-assess-post: 3-5 annotated examples per dimension
- Use OpenAI's JSON schema mode: `response_format: { type: "json_schema", schema: {...} }`
- Implement validation: if AI response doesn't match schema, log & retry once with temperature=0
- A/B test prompt variants vs control (measure diversity, accuracy)

**Dependencies**: No new deps; implemented in existing handlers.

---

### [OP-08] Add Real-Time Study Assistant with Vector Search
**Category:** AI & Intelligence  
**Impact:** Medium  
**Effort:** High  
**Priority Score:** 7

**Current state**: StudyLab exists (ai-study-chat) with full-text search fallback, but no semantic search. Documents ingested via PDF/DOCX but no embedding model.

**Opportunity**: Add vector embeddings for study sources. Use OpenAI `text-embedding-3-small` to embed materials, enable semantic search (find "energy efficiency tips" even if phrasing differs). Store vectors in pgvector.

**Business value**: 
- Better study material discovery
- More relevant AI context (semantic search > FTS)
- Enable "find similar topics" feature

**Technical approach**:
- Add pgvector extension to Supabase (enable in migration)
- Embed study_sources.full_text on upload via `ai-study-chat` handler
- Store embeddings in `study_source_embeddings(source_id, embedding)` table
- Query via cosine distance: `SELECT * FROM sources ORDER BY embedding <=> user_query_embedding LIMIT 5`
- Cache embeddings in Redis (immutable, safe to cache)

**Dependencies**: pgvector already in 20260116250000 migration; Supabase handles it.

---

### [OP-09] Build AI Content Suggestion Engine
**Category:** AI & Intelligence  
**Impact:** Medium  
**Effort:** Medium  
**Priority Score:** 6

**Current state**: No content recommendations. Users see static lists (all challenges, all study sources). Suggestions exist for campaigns/hashtags but not personalized.

**Opportunity**: Build AI-driven suggestions:
- "Recommended quizzes based on your tier & interests"
- "Challenges aligned to your team goals"
- "Study materials for gaps in your XP"
- Uses user history (quiz_attempts, challenge_submissions, study_chat_sessions)

**Business value**: 
- Increase engagement (users discover relevant content)
- Improve learning outcomes (targeted recommendations)
- Reduce information overload

**Technical approach**:
- Create handler `api/ai?handler=suggest-content`
- Input: user_id, org_scope (team/division), tier, recent_activity
- Call Claude: "Recommend 5 challenges for ${user.name} who is tier ${tier} and last did ${activity}. Format: JSON array of {challenge_id, reason, difficulty_estimate}"
- Cache recommendations for 24h
- Add "Recommended for You" section to Dashboard

**Dependencies**: New handler, no new infrastructure.

---

# 3. PRODUCT & UX

### [OP-10] Build Real-Time Leaderboard with Live Updates
**Category:** Product & UX  
**Impact:** High  
**Effort:** Medium  
**Priority Score:** 8

**Current state**: Rankings.tsx exists, fetches static data. No real-time updates. Users must refresh to see XP changes.

**Opportunity**: Implement Supabase Realtime subscriptions for leaderboards. When a user completes a quiz (XP awarded), all watching leaderboards update instantly.

**Business value**: 
- Gamification psychology: instant feedback drives engagement
- Reduce support tickets ("Why isn't my rank updating?")
- Competitive motivation: see rivals' scores live

**Technical approach**:
- Use `supabase.channel('leaderboard:team:{teamId}').on('postgres_changes', ...)` 
- Emit updates via PgTrigger when `profiles.xp` changes
- Debounce updates (max 5 per second per leaderboard) to avoid spam
- Fallback to polling for unstable connections (interval: 30s)
- Add "live" badge + animated score transitions

**Dependencies**: Supabase Realtime configured; RLS policies allow read of profiles.

---

### [OP-11] Add Progressive Web App (PWA) Capabilities
**Category:** Product & UX  
**Impact:** Medium  
**Effort:** High  
**Priority Score:** 7

**Current state**: Vite SPA, no service worker, no offline mode. Users can't access app without internet.

**Opportunity**: Add Workbox (Vite plugin) for:
- Offline-first quiz access (cache questions, save answers locally, sync on reconnect)
- Installable app icon (home screen shortcut)
- Push notifications for evaluations/mentions

**Business value**: 
- Works on trains, remote sites (energy company operations)
- Faster perceived load (cached assets)
- 30%+ engagement increase with installable apps

**Technical approach**:
- `npm install vite-plugin-pwa`
- Configure in vite.config.ts: cache strategies (network-first for API, cache-first for assets)
- IndexedDB for offline quiz attempts, study chat history
- ServiceWorker life-cycle management (self-update on background)
- Add web app manifest (name, icons, start_url)

**Dependencies**: vite-plugin-pwa, no impact on existing code.

---

### [OP-12] Implement Advanced Analytics Dashboard for Leaders/Admins
**Category:** Product & UX  
**Impact:** High  
**Effort:** High  
**Priority Score:** 8

**Current state**: Exists: `LeaderDashboard.tsx`, `ForumInsights.tsx`, `StudioDashboard.tsx` but fragmented. No unified analytics. No export/reporting.

**Opportunity**: Build centralized analytics hub:
- Team performance trends (XP, tier distribution, quiz pass rates)
- Forum health metrics (posts/day, avg helpfulness, toxicity trends)
- Challenge completion rates vs targets
- Study material engagement (views, chat interactions)
- Export to PDF/CSV for executive reports

**Business value**: 
- Data-driven decisions (which challenges work?)
- Accountability reporting (show ROI of DJT to executives)
- Identify struggling teams (early intervention)

**Technical approach**:
- Create `Analytics.tsx` page with tabs (Team, Forum, Challenges, Learning)
- Use Recharts (already in stack) for charts
- Implement new handlers: `api/misc?action=analytics-summary`, `analytics-export`
- Database views for aggregates: `v_team_xp_by_week`, `v_forum_metrics_by_month`
- CSV export via PapaParse

**Dependencies**: Database views (migration ~500 lines), Recharts already included.

---

### [OP-13] Add Dark Mode Theme Persistence & System Preference Detection
**Category:** Product & UX  
**Impact:** Low  
**Effort:** Low  
**Priority Score:** 4

**Current state**: next-themes integrated but preferences not saved to database. Uses localStorage only.

**Opportunity**: Persist theme preference in `profiles.theme_preference` column. Auto-detect system dark mode preference on first visit.

**Business value**: 
- Better UX (familiar appearance on return)
- Accessibility (users who need dark mode get it automatically)
- Reduces eye strain in evening usage

**Technical approach**:
- Add `theme_preference` (light|dark|system) to profiles table
- Update AuthContext to sync theme to DB on change
- Check system preference on first auth: `window.matchMedia('(prefers-color-scheme: dark)').matches`
- Implement in `index.css` via CSS variables (already using next-themes)

**Dependencies**: Migration ~50 lines, next-themes already in place.

---

### [OP-14] Gamification Enhancement: Achievement Badges & Streaks
**Category:** Product & UX  
**Impact:** Medium  
**Effort:** Medium  
**Priority Score:** 7

**Current state**: Tiers exist (bronze, silver, gold, platinum), XP tracking. No badges, no daily streaks, no milestones.

**Opportunity**: Add:
- Badges: "First Quiz", "Forum Contributor" (10+ helpful posts), "Challenge Champion", "Study Master"
- Daily streak counter (consecutive days active)
- Milestone notifications (1000 XP, tier up)
- Achievement leaderboard (e.g., fastest to platinum)

**Business value**: 
- Increased engagement (extrinsic motivation)
- Retention metrics improve (daily streaks vs one-time users)
- More shareable moments (badges to social feed)

**Technical approach**:
- Create `achievements` table: id, slug, title, description, icon, criteria
- Create `user_achievements` table: user_id, achievement_id, unlocked_at
- Implement trigger on `quiz_attempts.created_at` to check criteria
- Add achievement cards to Profile page
- Notify via Sonner toast when unlocked

**Dependencies**: Migration (~300 lines), no new external deps.

---

# 4. TECHNICAL DEBT & QUALITY

### [OP-15] Implement Comprehensive Test Suite (Unit & Integration)
**Category:** Technical Debt & Quality  
**Impact:** High  
**Effort:** High  
**Priority Score:** 8

**Current state**: 0 tests. `npm run test` exists but no test files. 1,127 console.log references. 76 TypeScript strict mode issues.

**Opportunity**: Add test coverage:
- Unit tests for utilities (tier calculations, quiz scoring, profile completion checks)
- Integration tests for API handlers (auth-login, quiz-practice-check)
- Component snapshot tests for forms (ChallengeForm, ProfileEditor)
- E2E tests for critical paths (register → complete profile → take quiz → earn XP)

**Business value**: 
- Catch regressions early
- Reduce post-deploy bugs by 70%
- Enable safe refactoring
- Faster onboarding for new developers

**Technical approach**:
- Use Vitest (Node test runner already referenced in scripts)
- Add `src/**/*.test.ts` files
- Mock Supabase via @supabase/test-helpers
- Start with critical paths: auth, quiz scoring, XP calculations
- Aim for 60% coverage on handlers, 80% on utils
- CI/CD: Run tests on PR before merge

**Dependencies**: Vitest, @testing-library/react, @supabase/test-helpers.

---

### [OP-16] Enforce TypeScript Strict Mode & Eliminate Any Types
**Category:** Technical Debt & Quality  
**Impact:** Medium  
**Effort:** High  
**Priority Score:** 6

**Current state**: `tsconfig.json` has `noImplicitAny: false, strictNullChecks: false`. 76 files have TypeScript errors or `@ts-nocheck`.

**Opportunity**: Gradually enable strict mode:
1. Set `noImplicitAny: true` (breaks ~200 places, mostly in server handlers)
2. Enable `strictNullChecks: true` (affects forms, optional fields)
3. Remove `@ts-nocheck` directives (currently in 15+ handlers)

**Business value**: 
- Prevent null/undefined runtime errors (most common bug class)
- Better IDE hints and refactoring support
- Documented contracts (types as documentation)

**Technical approach**:
- Incrementally enable flags (one per sprint)
- Use TypeScript compiler in strict mode locally
- Fix most common: `?.optional`, `as const`, `type guard` functions
- Prioritize handlers over pages (less volatile)

**Dependencies**: No external deps; TypeScript already at 5.9.3.

---

### [OP-17] Consolidate API Handler Structure & Remove Duplication
**Category:** Technical Debt & Quality  
**Impact:** Medium  
**Effort:** High  
**Priority Score:** 5

**Current state**: 75+ handlers with duplicated patterns:
- Auth token extraction (repeated in 30+ handlers)
- Supabase admin client creation (repeated in 20+ handlers)
- Error handling (inconsistent try/catch patterns)
- Role checking (repeated RBAC logic)

**Opportunity**: Create shared handler utilities:
- `getAdminClient()` - returns service-role Supabase client
- `requireAuth(req)` - extracts & validates token, throws on failure
- `requireRole(userId, allowedRoles)` - checks user_roles
- `apiResponse(data, status?)` - standard response format
- Custom error types: `ForbiddenError`, `ValidationError`

**Business value**: 
- Reduce handler code by 30%
- Consistent error handling & logging
- Easier to audit security (centralized auth)

**Technical approach**:
- Create `server/lib/handler-utils.ts` with shared functions
- Refactor 10 highest-priority handlers as examples
- Update dev docs with pattern
- Gradually migrate remaining handlers (3-4 per sprint)

**Dependencies**: Refactoring only, no new deps.

---

### [OP-18] Add Structured Logging & Observability
**Category:** Technical Debt & Quality  
**Impact:** Medium  
**Effort:** Medium  
**Priority Score:** 6

**Current state**: 1,127 `console.log` references, no centralized logging. No request IDs, no performance metrics.

**Opportunity**: Implement structured logging:
- Replace `console.log` with `log.info()` / `log.error()` (JSON format)
- Add request ID to each API call (track across logs)
- Log performance: handler duration, AI API latency, DB query time
- Send logs to external service (Sentry, LogRocket for errors)

**Business value**: 
- Debug production issues faster (trace request flow)
- Identify performance bottlenecks
- Alert on errors in real-time

**Technical approach**:
- `npm install pino` (lightweight JSON logger)
- Create `server/lib/logger.ts` with pino setup
- Add request ID middleware in API handlers (UUID)
- Log slow queries (>500ms threshold)
- Sentry integration for error tracking
- Dashboard: query logs in Vercel Analytics or external

**Dependencies**: pino, @sentry/node.

---

# 5. SECURITY & COMPLIANCE

### [OP-19] Implement LGPD Compliance Framework
**Category:** Security & Compliance  
**Impact:** High  
**Effort:** High  
**Priority Score:** 9

**Current state**: Recent RLS hardening (20260415120000) fixed major leaks. No data retention policy, no user export/deletion workflows, no consent tracking.

**Opportunity**: Build LGPD compliance suite:
- **Right to be forgotten**: DELETE cascade on user record
- **Data portability**: Export user data (profile, quiz attempts, posts, messages) as JSON
- **Consent tracking**: Log when user agrees to terms, track changes
- **Data minimization**: Remove soft-deleted records after 90 days
- **Breach notification**: Audit log for data access anomalies

**Business value**: 
- Legal compliance (avoid 2% GDP fines)
- Trust building (users see they control data)
- Reduces liability if hacked

**Technical approach**:
- Add `user_consents` table: user_id, consent_type (terms, marketing), version, ip_address, created_at
- Add `audit_logs` table: user_id, action (login, export, delete_request), timestamp, ip, user_agent
- Create handlers:
  - `POST /api/admin?action=user-data-export` - generates zip of user's data
  - `POST /api/admin?action=user-deletion-request` - flags for 30-day grace, then deletes
  - `DELETE /api/admin?action=purge-soft-deleted` - cleanup job
- Implement automatic deletion of soft-deleted records (migration with scheduled function)

**Dependencies**: New tables (migration ~200 lines), scheduled pg_cron job.

---

### [OP-20] Add Database Encryption at Rest & Encrypted Backups
**Category:** Security & Compliance  
**Impact:** Medium  
**Effort:** High  
**Priority Score:** 7

**Current state**: Supabase handles encryption via their infrastructure, but no explicit backup encryption policy documented or tested.

**Opportunity**: 
- Enable Supabase encryption at rest (verify with Supabase support)
- Implement encrypted backups: nightly export to S3 with KMS encryption
- Test recovery from encrypted backups quarterly
- Add field-level encryption for PII (phone, email optional fields) via `pgcrypto`

**Business value**: 
- Compliance with security standards
- Breach containment (even if DB accessed, PII stays encrypted)
- Audit trail for regulatory reports

**Technical approach**:
- Enable Supabase backup encryption settings (project settings)
- Script nightly backup job (Vercel Cron + Supabase CLI) with AWS KMS
- Implement PII field encryption: `pgcrypto.encrypt_iv()` for profiles.phone
- Document backup/recovery runbook
- Monthly encryption key rotation

**Dependencies**: Supabase Pro plan (backup included), AWS KMS setup, pgcrypto (extension in DB).

---

### [OP-21] Implement Rate Limiting on API Endpoints
**Category:** Security & Compliance  
**Impact:** Medium  
**Effort:** Medium  
**Priority Score:** 7

**Current state**: No rate limiting. DDoS vectors exist (auth-login can brute-force, ai endpoints can be hammered).

**Opportunity**: Add rate limiting:
- Login: 5 attempts per minute per IP
- AI endpoints: 10 requests per minute per user
- Forum: 20 posts per hour per user
- Study chat: 5 concurrent sessions per user

**Business value**: 
- Prevent brute-force attacks
- Prevent abuse of expensive AI endpoints
- Fair resource allocation

**Technical approach**:
- Use `@vercel/rate-limit` or `express-rate-limit` patterns
- Store rate limit state in Redis (Upstash)
- Implement in API handlers:
  ```ts
  const remaining = await checkRateLimit(userId, 'ai-chat', 10, 60);
  if (remaining < 0) return res.status(429).json({ error: 'Rate limit exceeded' });
  ```
- Return X-RateLimit-* headers in response
- Different limits for roles (admin: unlimited, collaborator: standard)

**Dependencies**: Redis (Upstash), no external rate-limit library needed.

---

# 6. INFRASTRUCTURE & DEVOPS

### [OP-22] Implement CI/CD Pipeline with Automated Testing
**Category:** Infrastructure & DevOps  
**Impact:** High  
**Effort:** High  
**Priority Score:** 8

**Current state**: Vercel auto-deploys on git push. No pre-deployment checks beyond build. No staging environment separate from prod.

**Opportunity**: Build CI/CD:
- GitHub Actions: lint, typecheck, test, build before allowing merge
- Staging environment: auto-deploy `develop` branch to separate Vercel preview
- Production: manual approval or auto-deploy `main` with rollback capability
- Automated smoke tests post-deploy (check homepage, login, quiz flow)

**Business value**: 
- Prevent bad code from reaching users
- Faster iteration (confident deployments)
- Easy rollback if issues found

**Technical approach**:
- Create `.github/workflows/test.yml`:
  ```yaml
  - npm run typecheck
  - npm run lint
  - npm run test
  - npm run build
  ```
- Add `.github/workflows/deploy.yml` for manual production approval
- Implement smoke tests: Playwright script checking critical paths
- Use Vercel environment aliases: `staging.djt-quest.com`, `prod.djt-quest.com`

**Dependencies**: GitHub Actions (free), Playwright for E2E tests.

---

### [OP-23] Migrate from Vercel Hobby to Pro/Enterprise Plan
**Category:** Infrastructure & DevOps  
**Impact:** High  
**Effort:** Low  
**Priority Score:** 8

**Current state**: Vercel Hobby plan limits:
- Functions: 6s timeout (extended to 60s via config, but soft limit)
- Builds: 45 minutes max
- Deployments: 100 per day
- Serverless function cold starts impact AI endpoints

**Opportunity**: Upgrade to Vercel Pro ($20/month) or Enterprise:
- 60s function timeout (hard limit)
- 120 builds per day
- Edge Middleware support for auth/rate-limiting
- Priority support

**Business value**: 
- Eliminate timeout errors on complex AI operations
- Better DX (faster builds, more deploys)
- Enterprise SLA (99.95% uptime)

**Technical approach**:
- Upgrade account to Pro tier
- Monitor function metrics in Vercel dashboard
- Leverage Edge Middleware for CORS, rate-limiting (moves off serverless)
- Implement Edge caching for static assets

**Dependencies**: Budget approval (~$240/year for Pro).

---

### [OP-24] Implement Distributed Tracing & APM
**Category:** Infrastructure & DevOps  
**Impact:** Medium  
**Effort:** High  
**Priority Score:** 6

**Current state**: No application performance monitoring. Can't trace request flow across handlers.

**Opportunity**: Add APM via Sentry or New Relic:
- Trace handler execution times
- Database query tracing
- AI API latency tracking
- Identify bottlenecks automatically

**Business value**: 
- Faster debugging (see where requests slow down)
- Proactive alerts (function takes >5s, alert team)
- Performance trends over time

**Technical approach**:
- Integrate Sentry SDK in `src/main.tsx` and API handlers
- Use `Sentry.startTransaction()` to trace handler execution
- Link database queries to transactions (add `performance: true`)
- Configure alerts: function duration > 5s, error rate > 1%
- Dashboard: view request waterfall, identify slow queries

**Dependencies**: Sentry (free tier sufficient), or New Relic APM.

---

### [OP-25] Build Automated Disaster Recovery & Backup Testing
**Category:** Infrastructure & DevOps  
**Impact:** High  
**Effort:** High  
**Priority Score:** 7

**Current state**: Supabase backups enabled (automatic), but recovery never tested. No documented runbook.

**Opportunity**: Implement DR strategy:
- Monthly full backup restore test (to staging DB)
- Runbook: "How to restore from backup"
- Database replication to standby region (Supabase read replica)
- RTO/RPO targets documented: 1h RTO, 15min RPO

**Business value**: 
- Know system survives failures
- Faster recovery if disaster happens
- Regulatory compliance (have tested backups)

**Technical approach**:
- Create `scripts/test-backup-restore.mjs`: restore latest backup to staging Supabase project
- Run monthly via GitHub Actions scheduled workflow
- Implement read replica in Supabase (different region)
- Document failover procedure in wiki
- Track recovery time metrics

**Dependencies**: Supabase replication feature (Pro plan).

---

# 7. BUSINESS & GROWTH

### [OP-26] Build Ecosystem Integration with CPFL/Enerlytics
**Category:** Business & Growth  
**Impact:** High  
**Effort:** High  
**Priority Score:** 9

**Current state**: Standalone platform for "large Brazilian energy company". No documented integration with parent Enerlytics ecosystem or CPFL operational systems.

**Opportunity**: Create integration points:
- **SSO**: OAuth2 integration with CPFL corporate directory (Okta/Azure AD)
- **Operational Base Sync**: Auto-sync org hierarchy from CPFL HR system
- **Energy Metrics**: Show real-time energy savings correlated with DJT challenges (Guardiao Vida impact data)
- **Executive Dashboard**: KPI dashboard for C-suite (engagement %, tier distribution, energy impact)
- **Data Export**: Daily reports to Enerlytics analytics platform

**Business value**: 
- Increased adoption (SSO removes friction)
- Data-driven ROI reporting (show energy savings)
- Cross-product ecosystem locks in users
- Revenue: upsell to other CPFL departments

**Technical approach**:
- Add OAuth2 flow via Passport.js or Supabase Auth integrations
- Create webhook endpoint for org structure sync from CPFL HR system
- Fetch energy metrics from CPFL API (daily_savings_kwh per team, correlated with challenges)
- Build executive dashboard page (ReCharts + KPI cards)
- Scheduled job to export metrics daily to Enerlytics data warehouse (S3 CSV)

**Dependencies**: 
- CPFL OAuth2 provider endpoint
- CPFL HR API documentation
- Energy metrics API endpoint
- Passport.js or existing Supabase Auth connector

---

### [OP-27] Implement Advanced Predictive Analytics & Recommendations
**Category:** Business & Growth  
**Impact:** Medium  
**Effort:** High  
**Priority Score:** 6

**Current state**: Historical data exists (quiz attempts, challenges, XP, forum posts). No predictive models. No churn risk detection.

**Opportunity**: Build ML models:
- **Churn prediction**: Identify users at risk of disengaging (no activity >7 days)
- **Success prediction**: Predict if user will pass challenge (recommend study materials)
- **Engagement forecasting**: Forecast team XP growth (plan challenges accordingly)
- **Content recommendation**: Collaborative filtering (users like you also enjoyed...)

**Business value**: 
- Retain at-risk users (proactive intervention)
- Personalization drives 20%+ engagement lift
- Better resource planning (know which teams need support)

**Technical approach**:
- Use Supabase `pgml` extension for in-database ML (linear regression for XP trends)
- Or integrate external: Python API via Lambda/Cloud Functions for advanced models
- Churn model: user inactive >7 days + no quiz attempts >14 days = risk score > 0.7
- Trigger email if risk score high
- Recommendation: collaborative filtering on quiz_attempts + forum_reactions
- A/B test impact (recommend vs no recommend)

**Dependencies**: Supabase pgml extension or external Python ML service.

---

### [OP-28] Build Mobile App (React Native) for Field Teams
**Category:** Business & Growth  
**Impact:** Medium  
**Effort:** High  
**Priority Score:** 6

**Current state**: Web-only. Field teams (operational staff at CPFL sites) may lack reliable internet.

**Opportunity**: React Native mobile app:
- Offline-first: download quizzes, challenges, study materials for offline access
- GPS-enabled Guardiao Vida (verify location when submitting)
- Push notifications for evaluations, mentions, leaderboard changes
- Native camera for evidence uploads

**Business value**: 
- Reach field teams (30%+ of CPFL staff)
- Offline capability key for operational sites
- Higher engagement (mobile notifications)
- Revenue: separate SKU for field team license

**Technical approach**:
- Expo or React Native CLI for iOS + Android
- Share business logic with web (same API, same TypeScript types)
- Implement offline sync via SQLite + background job (sync when online)
- Use expo-location for GPS, expo-camera for photo uploads
- Implement push via Expo Notifications (Firebase Cloud Messaging backend)

**Dependencies**: Expo CLI, React Native testing framework, app store deployment setup.

---

### [OP-29] Create Competitive Leaderboards & Social Sharing Features
**Category:** Business & Growth  
**Impact:** Medium  
**Effort:** Medium  
**Priority Score:** 7

**Current state**: Global leaderboard exists (Rankings.tsx). No team-vs-team competitions, no social sharing of achievements.

**Opportunity**: Add competitive features:
- **Team Tournaments**: Weekly XP challenges (team A vs team B)
- **Division Competitions**: All divisions compete for monthly trophy
- **Achievement Sharing**: Share badges to WhatsApp, LinkedIn (pre-filled text)
- **Replay Moments**: "Top 3 quiz performers this week" (shareable highlights)

**Business value**: 
- Viral engagement (users share achievements, friends join)
- Organizational pride (team competitions)
- Retention (weekly goal/competition keeps users active)

**Technical approach**:
- Create `competitions` table: id, name, start_date, end_date, team_ids[], prize
- Implement real-time leaderboard filtering by competition (Supabase RLS)
- Add share buttons: `whatsappShare()` function using web share API
- Create `Achievement.tsx` component with share button
- Build "Highlights" page: `POST /api/misc?action=get-weekly-highlights`

**Dependencies**: Web Share API (native), new handlers.

---

### [OP-30] Develop AI-Powered Content Moderation & Safety
**Category:** Business & Growth  
**Impact:** Medium  
**Effort:** Medium  
**Priority Score:** 6

**Current state**: Forum posts scored by AI (helpfulness, clarity, toxicity, CHAS), but no automatic action taken on toxic content.

**Opportunity**: Enhanced content moderation:
- **Auto-flag toxic posts**: Hide from feed if toxicity > 0.8 (awaiting mod review)
- **Profanity filtering**: Mask or remove known slurs
- **Spam detection**: Catch duplicate posts, mass mentions
- **Nudge toxic users**: Private message suggesting tone improvement

**Business value**: 
- Safe community (users feel respected)
- Reduced moderation workload (AI pre-screens)
- Improved psychological safety (less toxicity)

**Technical approach**:
- Enhance `forum-ai-assess-post` to include toxicity confidence scores
- Add auto-hide logic: if toxicity > 0.8, set `status: 'hidden_pending_review'`
- Implement profanity filter (simple regex + dictionary check)
- Add `hidden_posts` table: post_id, reason (toxicity|spam|profanity), auto_hidden_by
- Create moderation queue page: admins/leaders review hidden posts
- Email user if post hidden (with explanation)

**Dependencies**: Enhanced AI assessment (already exists), simple regex filters.

---

# 8. QUICK WINS (< 1 Week Implementation)

### [OP-31] Fix "Change Password" Redirect & Password Reset UI
**Category:** Product & UX  
**Impact:** Low  
**Effort:** Low  
**Priority Score:** 3

**Current state**: Auth.tsx has TODO comment: "redirect to /alterar-senha". Password reset flow exists but UI unclear.

**Opportunity**: 
- Implement `/senha/alterar` page (change password after must_change_password flag)
- Improve password reset email with clear instructions
- Add password strength meter to forms

**Technical approach**:
- Create `ChangePassword.tsx` page, route in App.tsx
- Update redirect after login: if `must_change_password`, go to `/senha/alterar`
- Use `ProfileEditor.tsx` pattern for form handling
- Add strength indicator via `zxcvbn` library

---

### [OP-32] Add Error Boundary for Forum Components
**Category:** Technical Debt & Quality  
**Impact:** Low  
**Effort:** Low  
**Priority Score:** 3

**Current state**: ForumTopic.tsx, Forums.tsx lack error boundaries. If API fails, entire page crashes.

**Opportunity**: Wrap in error boundary, show fallback UI, log to Sentry.

---

### [OP-33] Implement "Offline" Banner & Connectivity Detection
**Category:** Product & UX  
**Impact:** Low  
**Effort:** Low  
**Priority Score:** 3

**Current state**: No indication to user if connection drops. Requests silently fail.

**Opportunity**: Add `useOnline()` hook, show red banner "You're offline" when `navigator.onLine === false`.

---

---

# Priority Matrix Summary

| Score | Count | Category | Examples |
|-------|-------|----------|----------|
| **9-10** | 3 | Critical Revenue Impact | Multi-model AI (OP-06), LGPD Compliance (OP-19), CPFL Integration (OP-26) |
| **8** | 6 | High Impact, Medium Effort | Caching (OP-02), Query Optimization (OP-03), Real-time Leaderboard (OP-10) |
| **7** | 9 | Medium Impact, Varied Effort | Async Jobs (OP-04), DayPass (OP-05), PWA (OP-11) |
| **6** | 6 | Medium Impact, High Effort | Testing (OP-15), Analytics (OP-12) |
| **< 6** | 6 | Low Impact / Quick Wins | Password reset (OP-31), Error boundary (OP-32) |

---

# Implementation Roadmap Recommendation

**Phase 1 (Immediate, 2-3 weeks)**:
1. OP-06: Multi-model AI (high ROI, unlocks future efficiency)
2. OP-02: Request caching (quick, huge perf gain)
3. OP-31: Password reset (unblocks users)

**Phase 2 (Month 1)**:
4. OP-19: LGPD compliance (legal requirement)
5. OP-10: Real-time leaderboards (gamification boost)
6. OP-26: CPFL integration (business growth)

**Phase 3 (Month 2-3)**:
7. OP-03: Query optimization (scale prep)
8. OP-15: Testing (quality baseline)
9. OP-12: Analytics dashboard (decision support)

**Phase 4 (Month 4+)**:
- OP-04: Job queue (infrastructure)
- OP-27: Predictive analytics (advanced)
- OP-28: Mobile app (expansion)

---

# Success Metrics

Track impact of completed opportunities:

| Opportunity | Metric | Target | Baseline |
|-------------|--------|--------|----------|
| OP-02, OP-03 | API latency (p95) | < 200ms | ~500ms |
| OP-06 | AI cost per request | -30% | Current |
| OP-10 | Leaderboard update delay | < 2s | Manual refresh |
| OP-15 | Test coverage | 60% | 0% |
| OP-19 | LGPD audit pass | Yes | Unknown |
| OP-26 | SSO adoption | > 70% users | N/A (new) |
| OP-27 | Churn reduction | -25% | Baseline |

---

**Document Owner**: Rodrigo Nascimento  
**Last Updated**: April 15, 2026  
**Next Review**: June 15, 2026  
**Status**: Strategic Planning Phase
