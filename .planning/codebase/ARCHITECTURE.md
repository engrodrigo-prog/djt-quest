# DJT Quest System Architecture

## System Overview

DJT Quest is an enterprise learning and gamification platform designed to drive organizational transformation through structured learning paths, leadership challenges, community discussions, and AI-powered content generation. It enables users to earn experience points (XP), achieve tier levels, complete challenges, collaborate via forum discussions and social feed, and track progress through a sophisticated evaluation system.

**Core Purpose**: Engage employees in continuous learning and behavioral change through gamified challenges, collaborative forums, social learning (SEPBook), and leadership development.

---

## High-Level Request Flow

### Frontend → API → Backend

```
┌─────────────┐
│   React UI  │ (src/pages/*, src/components/*)
│  (Vite SPA) │
└──────┬──────┘
       │ HTTP/JSON
       │
┌──────▼────────────────────────────────┐
│    Vercel Edge / Node Functions        │
│  (api/*.ts routers)                    │
│  - auth-login                          │
│  - admin, ai, sepbook, forum, etc.     │
└──────┬───────────────────────────────┬┘
       │                               │
       │ JWT Auth Header               │ (optional via apiFetch)
       │ (Bearer token)                │
       │                               │
    ┌──▼──────────────────────────┐   │
    │  Supabase JS Client          │   │
    │  (Browser-side RLS)          │   │
    └──┬───────────────────────────┘   │
       │                               │
       │                        ┌──────▼────────────────────┐
       │                        │  Server Handlers           │
       │                        │  (server/api-handlers/*)   │
       │                        │  Use Service Role Key      │
       │                        │  (bypass RLS)              │
       │                        └──┬──────────────────────────┘
       │                           │
    ┌──▼───────────────────────────▼──┐
    │  PostgreSQL (Supabase)           │
    │  - auth.users                    │
    │  - public.profiles               │
    │  - public.quiz_questions         │
    │  - public.forum_topics/posts     │
    │  - public.challenges             │
    │  - public.sepbook_*              │
    │  - etc. (90+ migrations)         │
    │  Row-Level Security (RLS)        │
    └──┬─────────────────────────────┬─┘
       │                             │
    ┌──▼────────────────┐      ┌─────▼──────────────┐
    │  Supabase Storage │      │  OpenAI API        │
    │  (avatars,        │      │  (quiz generation, │
    │   attachments,    │      │   study chat,      │
    │   evidence)       │      │   transcription)   │
    └───────────────────┘      └────────────────────┘
```

### Authentication & Authorization

**Step 1: Login**
```
POST /api/auth-login
Body: { email, password }
  │
  └─> Handler validates via Supabase Auth endpoint
      │
      └─> Checks profiles.must_change_password flag (server-side)
          │
          └─> Returns { access_token, refresh_token, user, must_change_password }
              │
              └─> Client calls supabase.auth.setSession(data)
                  │
                  └─> localStorage persists session
                      Auto-refresh enabled via Supabase client
```

**Step 2: Authenticated Requests**
```
Frontend apiFetch() → Adds Bearer token header
  │
  └─> Vercel Handler → Receives JWT in Authorization header
      │
      └─> Supabase JS Client (anon key) handles RLS
          OR
      └─> Server handler with service role key → Bypasses RLS for admin ops
```

**Authorization Levels**:
1. **Public** - No auth required (landing, register page)
2. **Authenticated** - Valid JWT required (profile, dashboard)
3. **Role-Based** - Specific roles required (admin, leader, curator)
   - Checked in frontend via `useAuth()` context
   - Enforced server-side by RLS policies
   - Multi-role support via `user_roles` table

---

## Frontend Architecture

### Entry Point & Initialization
- **File**: `src/main.tsx`
- **Root**: `src/App.tsx`
- **Init**: Chunk error auto-reload, perf debugging, canonical origin check

### Application Structure

```
src/
├── pages/              # Route components (lazy-loaded)
│   ├── Home.tsx         # Landing/dashboard selection
│   ├── Auth.tsx         # Login/password reset
│   ├── Register.tsx     # User registration
│   ├── Dashboard.tsx    # Main learning dashboard
│   ├── Studio.tsx       # Quiz creation (curators)
│   ├── Forums.tsx       # Discussion topics
│   ├── SEPBook.tsx      # Social feed (legacy)
│   ├── SEPBookIG.tsx    # Social feed (new version)
│   ├── Profile.tsx      # User profile & settings
│   ├── Rankings.tsx     # Leaderboards
│   ├── Study.tsx        # Study materials & AI tutor
│   ├── Challenges.tsx   # Leadership challenges
│   ├── Finance.tsx      # Finance requests
│   ├── Evaluations.tsx  # Leadership evaluations
│   └── [others]
│
├── components/         # React components (70+)
│   ├── ui/             # shadcn/ui components (form, button, dialog, etc.)
│   ├── [Domain-specific]
│   │   ├── ProfileEditor.tsx
│   │   ├── ChallengeForm.tsx
│   │   ├── CampaignForm.tsx
│   │   ├── TeamPerformanceCard.tsx
│   │   ├── LeaderTeamDashboard.tsx
│   │   ├── StudioDashboard.tsx
│   │   ├── ForumKbThemeSelector.tsx
│   │   ├── AdminBonusManager.tsx
│   │   ├── VoiceRecorderButton.tsx
│   │   ├── AiProgressOverlay.tsx
│   │   └── [many more]
│   └── ProtectedRoute.tsx  # Auth guard
│
├── contexts/           # React Context providers
│   ├── AuthContext.tsx  # User auth, roles, profile, session
│   ├── I18nContext.tsx  # Locale, translations
│   └── [others]
│
├── hooks/              # Custom React hooks
│   └── use-toast.ts    # Toast notification hook
│
├── lib/                # Utilities & business logic
│   ├── api.ts          # apiFetch() for API calls with auth
│   ├── auth-login.ts   # Custom login handler
│   ├── biometricAuth.ts # Fingerprint fallback
│   ├── sfx/            # Sound effects system
│   ├── tts/            # Text-to-speech integration
│   ├── i18n/           # Internationalization
│   ├── forum/          # Forum utilities
│   ├── finance/        # Finance constants
│   ├── validations/    # Zod schemas (challenge, quiz)
│   ├── constants/      # Tiers, points, milhao levels
│   ├── profileCompletion.ts
│   ├── tierCalculations.ts
│   ├── operationalBase.ts
│   ├── sanitize.ts     # DOMPurify wrapper
│   └── [utilities]
│
├── integrations/
│   └── supabase/
│       ├── client.ts   # Supabase JS client instance
│       └── types.ts    # Auto-generated DB types
│
├── content/            # Static content
│   └── game-tips.ts
│
├── assets/             # Images, fonts
├── index.css           # Global Tailwind + custom styles
└── vite-env.d.ts       # Vite type definitions
```

### State Management

**Authentication State** (AuthContext):
- User object, session, roles, profile
- Multi-role support with override capability
- Organization scope (team, division, coordinator)
- Session caching (5 min TTL) to reduce DB hits

**UI State**:
- Toast notifications (Sonner + Radix UI)
- AI progress tracking (global store in `aiProgressStore`)
- Theme (next-themes)
- Locale (localStorage + Context)

**Data Fetching**:
- TanStack Query (React Query) for server state
- Automatic caching and refetching
- Used for quiz attempts, challenges, forum posts, leaderboards

**Client-Side Rendering**:
- React Router v7 for SPA navigation
- Lazy code splitting (Vite automatic)
- Fallback: 404 NotFound page
- SPA mode: All non-API routes serve index.html (Vercel rewrite)

### Component Patterns

**Protected Routes**:
```tsx
<Route element={<ProtectedRoute roles={['admin']}><AdminPage /></ProtectedRoute>} />
```

**Form Handling**:
- React Hook Form for form state
- Zod for schema validation
- Example: `ChallengeForm`, `CampaignForm`, `ProfileEditor`

**Profile Completion Check**:
- `CompleteProfile` modal appears if user missing required fields
- Can't access protected features until complete

---

## Backend API Architecture

### Vercel Serverless Functions

**Pattern**: Single entry-point routers with modular handler dispatch

**Router Structure**:
```
api/sepbook.ts
  └─> reads query.action or body.handler
      └─> Dispatches to /server/api-handlers/sepbook-post.ts
                                           /sepbook-comments.ts
                                           /sepbook-feed.ts
                                           /sepbook-likes.ts
                                           etc.
```

### Main Routers (api/*.ts)

| File | Purpose | Handlers |
|------|---------|----------|
| `auth-login.ts` | JWT auth | Password auth with must-change-password flag |
| `admin.ts` | Admin ops | User updates, XP, password resets, approvals |
| `ai.ts` | AI dispatcher | 15+ handlers for quiz, study, transcription, etc. |
| `register.ts` | Registration | Signup, pending approval, registration options |
| `sepbook.ts` | Social feed | Posts, comments, reactions, mentions, translations |
| `forum.ts` | Forum | Topics, posts, reactions, moderation, curation |
| `campaign.ts` | Campaigns | Evidence submit, stats, suggestions |
| `finance.ts` | Finance | Requests, admin review, approvals |
| `study.ts` | Study | Study sources, chat, content ingestion |
| `tts.ts` | Text-to-speech | Voice narration for content |
| `misc.ts` | Miscellaneous | Rankings, quizzes, challenges, geocoding, etc. |
| `version.ts` | Version | Build/version info |

### API Handler Count & Organization

**Total Handlers**: 75+ in `/server/api-handlers/`

**Categories**:
- **AI/Content Generation** (15): quiz-draft, quiz-milhao, study-chat, transcribe-audio, etc.
- **Forum** (12): create-topic, post, react, like, moderate, curate, close, etc.
- **Social Feed / SEPBook** (15): post, comments, reactions, mentions, trending, etc.
- **Admin & Auth** (12): user mgmt, role assign, password reset, approvals, registration
- **Challenges** (6): submit, update status, create, targets, evidence
- **Evaluations** (5): assign, queue, assessment, event handling
- **Finance** (5): request, evidence, admin review, approval workflow
- **Campaign** (5): evidence, stats, suggestions, links
- **Study & Learning** (8): sources, chat, quizzes, materials, ingestion
- **Utility** (6): rankings, geocoding, health checks, imports

### Request Size & Timeout Limits
- **Body Size**: 20MB (file uploads, attachments, document ingestion)
- **Timeout**: 60 seconds (max Vercel function duration)
- **AI Operations**: Often hit 45s timeout limit (StudyLab with web search)

### Key Architectural Patterns

**Async/Await Error Handling**:
```ts
try {
  // Create admin client with service role
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  
  // Call handler logic
  const result = await handler(supabaseAdmin, req.body, userId);
  
  return res.status(200).json(result);
} catch (e) {
  return res.status(500).json({ error: e?.message });
}
```

**Token Extraction & Validation**:
```ts
const authHeader = (req.headers.authorization as string) || '';
const token = authHeader.startsWith('Bearer ') 
  ? authHeader.slice(7) 
  : undefined;
const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
```

**Role-Based Access Control**:
```ts
const { data: roles } = await supabaseAdmin
  .from('user_roles')
  .select('role')
  .eq('user_id', userId);
  
const hasPermission = roles?.some(r => ALLOWED_ROLES.has(r.role));
if (!hasPermission) return res.status(403).json({ error: 'Forbidden' });
```

---

## Database Architecture

### PostgreSQL Schema (90+ Migrations, 15k+ lines SQL)

**Core Schema Areas**:

#### 1. Authentication & Identity
- `auth.users` - Supabase managed
- `public.profiles` - User profile data
- `public.user_roles` - Role assignments
- `public.pending_registrations` - Registration workflow

#### 2. Organization
- `public.org_structure` - Team/division/department hierarchy
- `public.event_participants` - Event enrollment

#### 3. Learning & Assessment
- `public.quiz_questions` - Question bank
- `public.quiz_attempts` - Performance tracking
- `public.study_sources` - Learning materials
- `public.study_chat_sessions` - StudyLab history

#### 4. Community & Discussion
- `public.forum_topics` - Discussion topics (CHAS aligned)
- `public.forum_posts` - Posts with AI assessment
- `public.forum_reactions` - Interaction metrics
- `public.forum_translations` - Multilingual content

#### 5. Social Learning (SEPBook)
- `public.sepbook_posts` - Social feed posts
- `public.sepbook_comments` - Comments with attachments
- `public.sepbook_reactions` - Social engagement
- `public.sepbook_mentions` - Mentions/notifications
- `public.sepbook_reposts` - Content sharing

#### 6. Leadership & Challenges
- `public.challenges` - Challenge definitions
- `public.challenge_submissions` - Evidence tracking
- `public.challenge_evidence` - Alternative evidence storage
- `public.evaluations` - Leadership assessments
- `public.evaluation_queue` - Assignment management

#### 7. Campaigns & Finance
- `public.campaigns` - Action/marketing campaigns
- `public.campaign_evidence` - Campaign submissions
- `public.campaign_links` - Campaign asset links
- `public.finance_requests` - Finance request workflow

#### 8. Support & Meta
- `public.password_reset_requests` - Password reset workflow
- `public.content_change_requests` - Content feedback

### Row-Level Security (RLS) Implementation

**Every table has RLS enabled** with policies controlling:
- **SELECT**: Usually public (everyone can read)
- **INSERT**: Restricted by role or user ownership
- **UPDATE**: Only creator or authorized roles
- **DELETE**: Only creator or admins

**Examples**:
- Forum topics: Leaders can create; users/leaders can update own
- Quiz attempts: Users see only own attempts
- Challenges: Public read; creators/leaders can modify
- Evaluations: Evaluators see assigned evals; admins see all
- SEPBook: Users edit own; leaders can moderate

### Key Database Features

**Full-Text Search**:
- `study_sources.full_text` uses `tsvector` for efficient searching
- Enables knowledge base discovery

**JSONB Payload Columns**:
- Forum posts: `payload {images, files, audio_url, transcript}`
- SEPBook: `payload {images, gps, ...}`
- Flexible schema evolution

**Indexes & Performance**:
- Multiple migrations optimize indexes
- Remove unused indexes to improve write performance
- Foreign key indexes for referential integrity

**Functions & Triggers**:
- Calculate XP from evaluations
- Update profile tier based on XP
- Track mention/notification counts
- Auto-timestamp columns (created_at, updated_at)

---

## AI Integration Architecture

### OpenAI Request Flow

```
User Action (e.g., "Generate Quiz")
  │
  └─> Frontend: POST /api/ai?handler=quiz-draft
      Body: { topic, difficulty, language }
      Header: { "X-AI-UI": "normal" | "silent" }
      │
      └─> aiProgressStore.startTask() → Shows progress toast
          │
          └─> api/ai.ts router
              │
              └─> server/api-handlers/ai-quiz-draft.ts
                  │
                  ├─> Validate auth + permissions
                  ├─> Build system prompt (PT-BR specific)
                  ├─> Call OpenAI API
                  │   POST https://api.openai.com/v1/chat/completions
                  │   Model: OPENAI_MODEL_PREMIUM
                  │   System: "Você é um gerador de questões..."
                  │   User: "Tema: ${topic}..."
                  │
                  ├─> Parse JSON response
                  ├─> Validate structure (question, correct, wrong[])
                  ├─> Insert into quiz_questions if saving
                  │
                  └─> Return { question, correct, wrong }
                      │
                      └─> Frontend: Parse response
                          aiProgressStore.endTask() → Hide toast
                          Render quiz editor
```

### StudyLab (AI-Powered Study Assistant)

```
POST /api/ai?handler=study-chat
Body: {
  mode: "ingest" | "chat",
  topic: string,
  conversation: [ { role, content } ],
  attachments?: [ { file, type } ]
}
  │
  └─> ai-study-chat.ts handler
      │
      ├─> If mode === "ingest":
      │   ├─> Parse PDF/DOCX (mammoth, pdf-parse)
      │   ├─> Extract text & clean
      │   ├─> Build context for AI
      │   │
      │   └─> Call OpenAI with context
      │       Timeout: 45s (STUDYLAB_OPENAI_TIMEOUT_MS)
      │
      ├─> If mode === "chat":
      │   ├─> Fetch relevant study sources (semantic search)
      │   ├─> Build system prompt with context
      │   ├─> Call OpenAI
      │   │   Model: OPENAI_MODEL_STUDYLAB_CHAT
      │   │   Fallback: gpt-5-nano-2025-08-07
      │   │
      │   └─> If timeout or insufficient knowledge:
      │       └─> Fallback to web search (12s timeout)
      │           Append web results to context
      │           Re-call OpenAI
      │
      └─> Save chat to study_chat_sessions
          Return { response, sources_used }
```

### Models & Inference

**Model Strategy**:
- **FAST Model**: Grammar cleanup, simple classification
- **PREMIUM Model**: Quiz generation, complex reasoning
- **VISION Model**: Image OCR (optional, may fall back to FAST)
- **CHAT Model**: Study assistant (nano variant for cost)
- **TTS Model**: Voice narration (4o-mini-tts)
- **TRANSCRIBE Model**: Audio → text (whisper-1 fallback)

**Cost & Performance Trade-offs**:
- Use FAST for simple tasks (cleanup, classification)
- Use PREMIUM for quiz generation (better diversity)
- Use NANO for studylab chat (cost efficiency)
- Use PREMIUM for complex reasoning (forum assessment)

---

## Frontend Data Flow & State

### Core User Journey

```
1. Landing (Home.tsx)
   └─> Unauthenticated → Auth page
       Authenticated → Dashboard selection

2. Authentication (Auth.tsx)
   └─> POST /api/auth-login
       ├─> Server checks must_change_password
       ├─> Client: supabase.auth.setSession()
       ├─> AuthContext updates with user/roles/profile
       └─> Redirect to Dashboard

3. Profile Completion Check
   └─> requiresProfileCompletion()
       ├─> Missing name, date_of_birth, phone?
       ├─> Show CompleteProfile modal
       └─> Block access until complete

4. Dashboard (Dashboard.tsx)
   └─> Display role-based options:
       ├─> Collaborator → Study, Challenges, Forums, Rankings
       ├─> Leader → + Evaluations, Team Performance
       ├─> Curator → + Studio (quiz creation)
       ├─> Admin → + Admin panel
       └─> Content Curator → + Content curation

5. Feature Access (e.g., Study.tsx)
   └─> useTanStackQuery() → Fetch study sources
       ├─> Backend RLS filters by user/org
       ├─> Display learning materials
       ├─> StudyLab: POST /api/ai?handler=study-chat
       │   ├─> Upload document or chat
       │   ├─> AI context building
       │   └─> Stream response
       └─> Save chat session in DB
```

### Real-Time & Reactive Features

**Forum Post Assessment**:
- User posts in forum
- Backend: AI analyzes (helpfulness, clarity, toxicity, CHAS)
- Stored in `forum_posts.ai_assessment` JSONB
- Frontend filters/sorts by assessment scores

**Leaderboard Updates**:
- XP earned from quiz completion
- Automatic tier recalculation
- Leaderboard queries pull latest XP/tier

**Mention Notifications**:
- Post with @mention triggers database entry
- Frontend polls or Supabase real-time subscriptions
- Mark as seen in `sepbook_mentions.status`

---

## Key Design Patterns & Decisions

### 1. Vercel Rewrites for Clean URLs
Instead of `/api/sepbook?action=post`, can use `/api/sepbook-post`. Vercel.json rewrites normalize to query params for handler dispatch.

### 2. Service Role for Admin Operations
Server-side handlers use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS, enabling admin-only operations (approvals, role changes, user creation) without user-level RLS constraints.

### 3. AI Progress Tracking with Store
`aiProgressStore` decouples AI task progress from component state, allowing global progress overlay (`AiProgressOverlay`) to track multiple concurrent operations.

### 4. Session Caching
5-minute localStorage cache for `auth_user_cache` reduces database queries during rapid page navigation.

### 5. I18n with Dynamic AI Translation
Missing translations fetched/filled via OpenAI script, avoiding need for manual translation updates.

### 6. JSONB for Flexible Payloads
Forum posts store `payload {images, files, audio, transcript}` as JSONB, avoiding schema changes for new content types.

### 7. Lazy Code Splitting
React Router + Vite lazy-load pages, vendor chunks split by concern (react, ui, data, forms, maps, charts, dates, misc).

### 8. RLS Enforced at Database
All business logic validation happens in PostgreSQL policies, preventing accidental data access in frontend.

---

## Performance Considerations

### Frontend
- Vite dev server with hot reload
- React code splitting (lazy routes)
- TanStack Query caching (avoid redundant API calls)
- Chunk error auto-recovery

### Backend
- Vercel function timeout: 60s (AI operations may push limit)
- 20MB body size for file uploads
- Service role queries efficient (single batch operations)
- API handlers use async/await (non-blocking I/O)

### Database
- Full-text search index on study sources
- Foreign key indexes for query optimization
- RLS policies cached by Supabase
- Pagination for large result sets

### Network
- CORS enabled for Supabase + OpenStreetMap
- API responses cached via HTTP headers (no-store for API)
- Static assets cached by browser
- Vercel Edge caching for global distribution

---

## Summary Architecture Table

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19 + Router v7 + Vite | SPA UI with lazy loading |
| **UI Components** | Radix UI + Tailwind CSS | Accessible, themed components |
| **Forms** | React Hook Form + Zod | Validation & state management |
| **Data Fetching** | TanStack Query + apiFetch | Caching, auth handling |
| **API Gateway** | Vercel Functions | Serverless routing |
| **Auth** | Supabase Auth (JWT) | Email/password, session mgmt |
| **Database** | PostgreSQL (Supabase) | Schema, RLS, full-text search |
| **File Storage** | Supabase Storage | Avatars, attachments, evidence |
| **AI/LLM** | OpenAI API | Quiz gen, study chat, assessment |
| **Realtime** | Supabase subscriptions | Notifications, live updates |
| **Deployment** | Vercel | Edge functions, global CDN |

