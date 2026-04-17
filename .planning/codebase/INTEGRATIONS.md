# DJT Quest External Integrations

## Supabase (Complete Platform)

### Purpose
DJT Quest is built on Supabase as the primary backend service, providing authentication, database, storage, and real-time subscriptions.

### Configuration
- **Project Reference**: `eyuehdefoedxcunxiyvb`
- **Project Host**: `eyuehdefoedxcunxiyvb.supabase.co`
- **Environment Variables**:
  - `VITE_SUPABASE_URL` - Supabase project URL (required)
  - `VITE_SUPABASE_PUBLISHABLE_KEY` - Anon key for client-side requests (alternative: `VITE_SUPABASE_ANON_KEY`)
  - `VITE_SUPABASE_PROJECT_ID` - Project ID (optional, for reference)
  - `SUPABASE_SERVICE_ROLE_KEY` - Service role key for server-side admin operations (required for API handlers)

### Authentication Service
**Type**: JWT-based email/password authentication

**Client-Side Usage**:
- Location: `/src/integrations/supabase/client.ts`
- Creates unauthenticated Supabase client with anon key
- Auto-refresh tokens enabled in localStorage
- Session persistence across page reloads

**Auth Flow**:
1. User logs in via `/api/auth-login` (custom handler)
2. Handler calls Supabase auth endpoint directly to get JWT
3. Server checks `profiles.must_change_password` flag post-login
4. Client receives `access_token`, `refresh_token`, `user`, and `must_change_password`
5. Client calls `supabase.auth.setSession()` to establish session
6. Subsequent requests include Bearer token in Authorization header

**Session Management** (AuthContext.tsx):
- Cache: 5-minute TTL for user profile to reduce database queries
- Cache Key: `auth_user_cache` in localStorage
- Timeout Protection: Requests to Supabase auth have 12-second timeout
- Role Override: Dev feature to test role-based UIs (stored in `auth_role_override`)
- Session Locking: Emergency UX pattern (stored in `djt_session_locked`)

**Multi-Role Support**:
- Users can have multiple roles assigned
- Roles stored in `public.user_roles` junction table
- Highest-priority role selected for default display
- Role hierarchy: admin > manager > coordinator > leader > collaborator

**Admin Operations**:
- Server handlers use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS
- Can create/update users, manage roles, reset passwords
- Used for registration approval, user onboarding, admin fixes

### Database Schema (PostgreSQL)

**Key Tables**:

#### Core User Management
- `auth.users` - Supabase managed, don't modify directly
- `public.profiles(id, email, name, avatar_url, avatar_thumbnail_url, tier, xp, phone, date_of_birth, locale, sfx_enabled, tts_enabled, ...)`
  - Stores user profile data, preferences, XP, tier
  - Each profile linked to auth.users(id)
  - Tier calculation based on XP
  - Contains role assignments via join to user_roles
  
- `public.user_roles(user_id, role)` - Junction table for role assignments

#### Organizational Structure
- `public.org_structure` - Hierarchical teams, divisions, departments
- `public.profiles.team_id, division_id, coord_id` - Links to organizational hierarchy

#### Learning & Assessment
- `public.quiz_questions(id, topic, content, difficulty, category, correct_answer, wrong_answers, explanation, ...)`
  - Question bank for quizzes
  - Supports multiple categories (geral, especialidade, etc.)
  - Difficulty levels: basico, intermediario, avancado
  
- `public.quiz_attempts(user_id, quiz_id, score, passed, time_taken, help_used, ...)`
  - Tracks user quiz performance
  - Stores which hints/helps were used
  - Calculates XP awards based on score
  
- `public.challenges(id, title, description, creator_id, status, targets, theme, ...)`
  - Leadership challenges for organizational change
  - Tracks submission status and evidence
  - Associated with specific divisions/teams

- `public.challenge_submissions(challenge_id, user_id, evidence_url, status, ...)`
  - Evidence submissions for challenges
  - Includes metadata about submission
  - Can have multiple submissions per challenge

#### Forum & Community
- `public.forum_topics(id, title, description, created_by, status, chas_dimension, quiz_specialties, tags, ...)`
  - Discussion topics aligned to CHAS (Cognitive, Human, Attitudinal, Social)
  - Status: open, curated, closed
  - Related to quiz specialties (alignement to learning paths)
  
- `public.forum_posts(id, topic_id, user_id, content_md, payload{images, files, audio_url, transcript}, parent_post_id, ai_assessment{helpfulness, clarity, novelty, toxicity, flags, chas}, tags, ...)`
  - Posts with markdown content
  - Stores media attachments in JSONB payload
  - Includes AI-generated assessment scores
  - Supports threaded discussions via parent_post_id
  
- `public.forum_reactions(id, post_id, user_id, type{like, helpful, agree, insight}, ...)`
  - Reactions to posts
  - Multiple reaction types (not just likes)
  - Unique constraint per post/user/type (one per user per type)

#### Social Feed (SEPBook)
- `public.sepbook_posts(id, user_id, content_md, payload{images, gps, ...}, created_at, ...)`
  - Social feed posts with optional GPS data (Guardiao Vida challenges)
  - JSONB payload for flexible metadata
  
- `public.sepbook_comments(id, post_id, user_id, content_md, payload{attachments, ...}, ...)`
  - Comments on posts with file attachment support
  
- `public.sepbook_reactions(post_id, user_id, type, ...)`
  - Like/react to posts and comments

- `public.sepbook_mentions(id, mentioned_user_id, content_url, status{seen, unseen}, ...)`
  - Tracks mentions for inbox/notifications
  
- `public.sepbook_reposts(id, original_post_id, user_id, ...)`
  - Repost tracking for content sharing

#### Study & Learning Materials
- `public.study_sources(id, title, content, full_text, source_type{pdf, doc, link}, topics, tags, created_by, status, catalog, ingest_status{pending, indexed, failed}, ...)`
  - Learning materials library
  - Full-text search enabled via `tsvector`
  - Knowledge base indexing with hashtag suggestions
  
- `public.study_chat_sessions(id, user_id, topic, messages[], ...)`
  - Stores chat history for StudyLab AI assistant
  - Enables context-aware learning

#### Campaign & Content
- `public.campaigns(id, title, description, status, participants, ...)`
  - Marketing campaigns, action campaigns
  - Tracks participation and evidence submissions
  
- `public.campaign_evidence(id, campaign_id, user_id, description, attachments, ...)`
  - Evidence submissions for campaigns
  - Can link to challenges

#### Finance
- `public.finance_requests(id, user_id, type, amount, description, status, evidence, ...)`
  - Finance request workflow
  - Status: draft, submitted, approved, rejected
  - Includes evidence/documentation

#### Events & Evaluations
- `public.event_participants(id, event_id, user_id, status, ...)`
  - Event enrollment
  
- `public.evaluations(id, evaluator_id, evaluatee_id, event_id, assessment, ...)`
  - Leadership evaluations
  - Tracks assessor-assessees relationships
  
- `public.evaluation_queue(id, user_id, evaluators[], status, ...)`
  - Queue system for evaluation assignments
  - Manages evaluator assignments for each user

#### Notifications & Inbox
- `public.pending_registrations` - Awaiting admin approval
- `public.password_reset_requests` - Password reset workflow

### Row-Level Security (RLS)

**Enforcement Model**:
- All user-facing tables have RLS enabled
- Default: SELECT all, INSERT/UPDATE/DELETE restricted by role/ownership
- Service role (admin key) bypasses RLS for server operations
- Policies enforce business rules at database level

**Example Policies**:
- **forum_topics**: Leaders can create; creator or leaders can update
- **forum_posts**: Everyone can read; users insert/update own posts
- **quiz_attempts**: Users can only see own attempts
- **challenges**: Visible to all; only creators/leaders can modify
- **sepbook_posts**: Users can only edit own posts; leaders can moderate
- **evaluations**: Evaluators can see assigned evaluations; admins see all

### Storage Buckets

**Public Buckets**:
- `avatars` - User profile pictures (public read, auth write)
- `study_materials` - Learning resources (public read)

**Private Buckets**:
- `attachments` - Forum post attachments (auth read/write)
- `evidence` - Challenge evidence submissions (owner + leader access)

---

## OpenAI Integration

### Purpose
AI-powered content generation, assessment, transcription, and study assistance

### Configuration
**API Key**: `OPENAI_API_KEY` (server-side environment variable only, never exposed to client)

**Model Configuration**:
```
OPENAI_MODEL_FAST=gpt-5-2025-08-07                    # Fast tasks (default fallback)
OPENAI_MODEL_PREMIUM=gpt-5-2025-08-07                 # Complex generation (default fallback)
OPENAI_MODEL_VISION=gpt-5-2025-08-07                  # Vision/OCR (optional, falls back to main)
OPENAI_MODEL_AUDIO=gpt-audio-2025-08-28               # Audio models (optional)
OPENAI_TRANSCRIBE_MODEL=whisper-1                     # Audio transcription (fallback default)
OPENAI_MODEL_STUDYLAB_CHAT=gpt-5-nano-2025-08-07     # StudyLab chat (fallback default)
OPENAI_TTS_MODEL=gpt-4o-mini-tts                      # Text-to-speech
```

**Timeouts**:
- `STUDYLAB_OPENAI_TIMEOUT_MS=45000` - Max wait for AI response
- `STUDYLAB_WEB_SEARCH_TIMEOUT_MS=12000` - Max wait for web search fallback
- `STUDYLAB_INLINE_IMAGE_BYTES=1500000` - Max image size for inline embedding

### API Handlers Using OpenAI

**Quiz Generation Pipeline**:
1. `ai-quiz-draft` - Generate question, correct answer, explanation (via OPENAI_MODEL_PREMIUM)
2. `ai-generate-wrongs` - Generate 3 plausible wrong answers (via OPENAI_MODEL_FAST or PREMIUM)
3. `ai-parse-quiz-text` - Parse quiz text dump into structured questions
4. `ai-quiz-milhao` - Generate "Who Wants to Be a Millionaire" style quiz
5. `ai-quiz-burini` - Generate quiz variant (Burini style)

**Study & Learning**:
1. `ai-study-quiz` - Generate practice quiz from study materials
2. `ai-study-chat` - StudyLab conversational study assistant
   - Supports web search fallback if knowledge base insufficient
   - Ingests PDF/DOCX documents
   - Multi-turn conversation with context

**Audio Processing**:
1. `transcribe-audio` - Audio to text transcription
   - Uses native OpenAI audio endpoint or Whisper-1 fallback
   - Supports MP3, WAV, M4A formats

**Text Processing**:
1. `forum-cleanup-text` - Grammar, punctuation, orthography correction
2. `ai-translate-text` - Dynamic content translation (forum posts, quiz descriptions)
3. `ai-suggest-hashtags` - Topic/content hashtag suggestions (JSON output)
4. `ai-proofread-ptbr` - Portuguese-BR specific proofreading

**Assessment**:
1. `forum-ai-assess-post` - Score forum posts for:
   - Helpfulness (1-5)
   - Clarity (1-5)
   - Novelty/Originality (1-5)
   - Toxicity flag (yes/no)
   - CHAS classification (C/H/A/S)
   - Suggested tags

### Integration Pattern

All AI requests route through `/api/ai?handler=<name>`:

```
POST /api/ai
?handler=quiz-draft
Body: { topic: string, difficulty: string, language: string }
Response: { question, correct, wrong, ... }
```

**Server-Side Implementation**:
- OpenAI client instantiated in API handlers only
- Responses cached in database where appropriate
- Timeouts prevent hanging requests
- Error handling with fallback messages

**UI Integration**:
- Progress tracking via `aiProgressStore` (toast notifications)
- "Silent" mode: `X-AI-UI: silent` header suppresses progress UI
- Async operations don't block user interactions

---

## Maps & Geolocation

### Leaflet + OpenStreetMap
**Purpose**: Display maps, GPS coordinates (used in Guardiao Vida challenges)

**Libraries**:
- `leaflet@1.9.4` - Map library
- `react-leaflet@5.0.0` - React wrapper

**Geocoding**: OpenStreetMap Nominatim API
- `VITE_API_BASE_URL/api/reverse-geocode` - Convert GPS to address
- CSP allows `https://nominatim.openstreetmap.org`

**Use Cases**:
- SEPBook posts with GPS location
- Challenge location tagging
- Team/division geographic distribution

---

## Text-to-Speech (TTS)

### Configuration
- **Model**: `OPENAI_TTS_MODEL` (e.g., gpt-4o-mini-tts)
- **Endpoint**: `/api/tts`
- **Client**: `src/lib/tts/` - TtsProvider + TtsPlayerBar component

**Features**:
- Generate audio from text
- Support for multiple voices/speeds
- Inline player component
- User preference storage (enabled/disabled in profiles.tts_enabled)

**Usage**:
- Forum posts read aloud
- Study content narration
- Quiz question audio

---

## Internationalization (i18n)

### AI-Powered Translation
- **Script**: `scripts/i18n-ai-fill.mjs`
- **Purpose**: Auto-fill missing translations via OpenAI
- **Supported Locales**: Portuguese (pt-BR), English (en), Spanish (es), etc.
- **Dynamic Translation**: Quiz answers, forum content, challenge descriptions

### Locale Management
- **Active Locale**: Stored in localStorage, synced to `profiles.locale`
- **Default**: pt-BR (Portuguese-Brazil)
- **UI Switching**: Dropdown in settings

---

## Deployment & Environment

### Vercel Configuration
**File**: `vercel.json`

**Rewrites** (Unified API Routing):
- `/api/sepbook-:action` → `/api/sepbook?action=:action`
- `/api/campaign-:action` → `/api/campaign?action=:action`
- `/api/finance-:action` → `/api/finance?action=:action`
- `/api/coord-ranking` → `/api/misc?action=coord-ranking`
- `/api/quiz-practice-check` → `/api/misc?action=quiz-practice-check`
- `/api/challenge-action-submit` → `/api/misc?action=challenge-action-submit`
- `/api/guardiao-vida-dashboard` → `/api/misc?action=guardiao-vida-dashboard`
- `/api/profile-lookup` → `/api/misc?action=profile-lookup`
- `/api/registration-options` → `/api/misc?action=registration-options`
- `/api/reverse-geocode` → `/api/misc?action=reverse-geocode`
- `/api/forum-mentions-mark-seen` → `/api/misc?action=forum-mentions-mark-seen`
- SPA fallback: All non-API routes → `/`

**Security Headers**:
- X-Frame-Options: DENY (prevent clickjacking)
- X-Content-Type-Options: nosniff
- CSP: Restricted script/style/connect sources
- HSTS: 63072000 seconds (2 years) with preload
- Permissions-Policy: Camera/mic denied, geolocation/payment allowed
- Referrer-Policy: strict-origin-when-cross-origin

**CORS** (auth-login, ai.ts handlers):
- Origin validation against `ALLOWED_ORIGINS` env var
- Fallback: Allow Vercel preview deploys (*.vercel.app)
- Explicit Vary: Origin header for cache correctness

**Caching**:
- API routes: `Cache-Control: no-store, max-age=0` (no caching)
- Static: Default browser cache

### Environment Variables (Vercel & Local)

**Required**:
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` - Anon auth key
- `SUPABASE_SERVICE_ROLE_KEY` - Admin key for API handlers
- `OPENAI_API_KEY` - OpenAI API key

**Optional/Recommended**:
- `VITE_API_BASE_URL` - API base URL for local dev
- `VITE_APP_ORIGIN` - Canonical app origin for links/redirects
- `ALLOWED_ORIGINS` - CORS allowed origins (comma-separated)
- OpenAI model overrides (OPENAI_MODEL_FAST, OPENAI_MODEL_PREMIUM, etc.)
- Timeout configs (STUDYLAB_OPENAI_TIMEOUT_MS, etc.)

---

## Error Handling & Resilience

### Backend
- Timeout protection on Supabase auth (12s)
- Fallback messages for OpenAI errors
- JSON repair for malformed responses (`jsonrepair` library)
- Service role fallback for auth failures

### Frontend
- Chunk error recovery (auto-reload on module load failure)
- Error boundary (AppErrorBoundary)
- Toast notifications for user-facing errors
- Session timeout warnings
- Biometric auth fallback (fingerprint → password)

---

## Third-Party Libraries Integration Summary

| Service | Library | Purpose | Env Vars |
|---------|---------|---------|----------|
| Supabase | @supabase/supabase-js | Auth, DB, Storage | VITE_SUPABASE_URL, _KEY, SUPABASE_SERVICE_ROLE_KEY |
| OpenAI | openai | AI/LLM | OPENAI_API_KEY, OPENAI_MODEL_* |
| Maps | leaflet, react-leaflet | Maps, GPS | (Built-in OSM) |
| Forms | react-hook-form, zod | Validation | (None) |
| UI | @radix-ui/*, tailwindcss | Components | (None) |
| Charts | recharts | Data viz | (None) |
| Dates | date-fns, react-day-picker | Date picking | (None) |
| Query | @tanstack/react-query | Data fetching | (None) |
| i18n | Custom + OpenAI | Translations | (Built-in) |
| TTS | OpenAI | Audio narration | OPENAI_TTS_MODEL |
| Notifications | sonner | Toast UI | (None) |
