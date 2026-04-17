# DJT Quest Technology Stack

## Overview
DJT Quest is a comprehensive enterprise learning and gamification platform built with a modern JavaScript/TypeScript full-stack architecture. It combines a frontend-first Vite + React application with serverless backend APIs, integrated with Supabase for authentication and PostgreSQL data persistence.

## Runtime & Language
- **Node.js**: 24.x (specified in package.json engines)
- **Language**: TypeScript 5.9.3 with strict transpilation
- **Module System**: ES6 (type: "module" in package.json)
- **Runtime Environment**: Vercel Functions (edge runtime for API handlers)

## Frontend Framework & Build
- **Framework**: React 19.2.4 with React Router v7 for navigation
- **Build Tool**: Vite 7.3.1 with React plugin
- **Transpiler**: TypeScript compiler (tsc) for type checking before build
- **Package Manager**: npm (also supports bun per bun.lockb)
- **Dev Server**: Vite dev server on port 8080 with proxy to localhost:3000 for API

### Build Configuration
- **Manual Chunking**: Vendors split into logical chunks (vendor-react, vendor-ui, vendor-data, vendor-forms, vendor-maps, vendor-charts, vendor-dates, vendor-misc)
- **Sourcemaps**: Optional, controlled via VITE_SOURCEMAP or GENERATE_SOURCEMAP env vars
- **Entry Point**: index.html → src/main.tsx → App.tsx

## UI Framework & Component Library
- **Component Framework**: shadcn/ui (Radix UI primitives + Tailwind CSS)
- **CSS Framework**: Tailwind CSS 4.2.1 (CSS-first configuration via index.css)
- **Icon Library**: Lucide React 0.577.0 (SVG icons)
- **Radix UI Primitives** (v1.1+): Complete suite for accessible components
  - Dialog, Drawer, Popover, Tooltip, Dropdown Menu, Context Menu
  - Accordion, Collapsible, Tabs, Select, Combobox (cmdk)
  - Checkbox, Radio Group, Switch, Toggle, Toggle Group
  - Slider, Progress, Scroll Area, Hover Card
  - Alert Dialog, Navigation Menu, Menubar, AspectRatio

### Advanced UI Components
- **Form Handling**: React Hook Form 7.71.2 + @hookform/resolvers 5.2.2
- **Schema Validation**: Zod 4.3.6 (TypeScript-first schema validation)
- **Toast Notifications**: Sonner 2.0.7 (toast/sonner) + Radix UI Toast
- **Command Palette**: cmdk 1.1.1 (Cmd+K interface)
- **Date Picker**: React Day Picker 9.14.0 + date-fns 4.1.0
- **Carousel**: Embla Carousel React 8.6.0
- **OTP Input**: input-otp 1.4.2
- **Resizable Panels**: react-resizable-panels 4.7.1
- **Sheet/Drawer**: vaul 1.1.2
- **Typography**: @tailwindcss/typography for markdown-like content

### Charts & Data Visualization
- **Charts**: Recharts 3.7.0 (React charts library)
- **Maps**: Leaflet 1.9.4 + React Leaflet 5.0.0 (OpenStreetMap integration)
- **File Utilities**: exifr 7.1.3 (EXIF metadata extraction)

## Backend API Architecture
- **Runtime**: Vercel Functions (Node.js serverless)
- **Handler Pattern**: Single entry-point routers that dispatch to modular handlers
- **Request Proxying**: Vercel rewrites to consolidate endpoints
  - `/api/sepbook-:action` → `/api/sepbook?action=:action`
  - `/api/campaign-:action` → `/api/campaign?action=:action`
  - `/api/finance-:action` → `/api/finance?action=:action`
  - Multiple misc endpoints unified under `/api/misc?action=:action`

### API Handlers
- **Location**: `/api/*.ts` (main routers) dispatch to `/server/api-handlers/*.ts` (implementations)
- **Main Routers** (12 files):
  - `auth-login.ts` - Supabase password auth with must-change-password flag
  - `admin.ts` - Admin operations (user updates, XP adjustments, password resets, registrations)
  - `ai.ts` - AI handler dispatcher (quiz generation, transcription, translations, cleanup)
  - `register.ts` - User registration flow
  - `sepbook.ts` - Social feed (posts, comments, reactions, mentions, translations)
  - `forum.ts` - Forum discussions (topics, posts, reactions)
  - `campaign.ts` - Campaign management
  - `finance.ts` - Finance request handling
  - `study.ts` - Study/learning endpoints
  - `tts.ts` - Text-to-speech
  - `misc.ts` - Misc endpoints (rankings, quizzes, challenges, geocoding)
  - `version.ts` - Version info

- **API Handler Count**: 75+ specialized handlers in `/server/api-handlers/`
  - AI handlers: quiz-draft, quiz-milhao, quiz-burini, study-quiz, study-chat, transcribe-audio, parse-quiz-text, etc.
  - Forum: create-topic, post, react, like, moderate, curate, close, etc.
  - Admin: user management, XP adjustments, password resets, role assignments
  - SEPBook: posts, comments, reactions, mentions, trending, summary, tags
  - Campaign: evidence submit, stats, suggestions
  - Finance: request submission and admin review
  - Auth: registration approval, password reset workflows
  - Studio: quiz creation, user management, pending registrations
  - Challenge: submission and status updates

### Request Size Limits
- Body parser limit: 20MB (for file uploads and attachments)
- Max Duration: 60 seconds (Vercel function timeout)

## Database & Backend Services
- **Primary Database**: PostgreSQL (Supabase)
- **Auth Service**: Supabase Auth (JWT-based, built on pgboss/postgres)
- **BaaS**: Supabase (auth, database, storage, realtime subscriptions)
- **Service URLs**:
  - Project Reference: `eyuehdefoedxcunxiyvb.supabase.co`
  - Validated against hardcoded host in client config

### Database Schema Highlights
- **Migrations**: 90+ SQL migrations (15k+ lines total) in `/supabase/migrations/`
- **Core Tables**: 
  - `auth.users` - Supabase auth managed table
  - `public.profiles` - User profiles (name, avatar, tier, XP, roles, preferences)
  - `public.org_structure` - Teams, divisions, departments hierarchy
  - `public.quiz_questions` - Quiz content with correct/wrong answers
  - `public.quiz_attempts` - User quiz attempts with scoring
  - `public.forum_topics` - Discussion topics (CHAS dimensions)
  - `public.forum_posts` - Posts with AI assessment (helpfulness, clarity)
  - `public.forum_reactions` - Like/agree/insight reactions
  - `public.challenges` - Leadership challenges with targets
  - `public.challenge_submissions` - Evidence submissions
  - `public.sepbook_posts` - Social feed posts with GPS support
  - `public.sepbook_comments` - Comments on posts with attachments
  - `public.campaigns` - Marketing/action campaigns
  - `public.study_sources` - Learning materials with full-text search
  - `public.study_chat_sessions` - Study assistant chat history
  - `public.finance_requests` - Finance submission workflow
  - `public.event_participants` - Event enrollment
  - `public.evaluations` - Leadership evaluation assignments

### Authentication & Authorization (RBAC)
- **Auth Method**: JWT tokens from Supabase Auth
- **Session Management**: localStorage persistence with auto-refresh
- **Roles Table**: `public.user_roles(user_id, role)` - supports multiple roles per user
- **Role Types**:
  - `admin` - Full platform access
  - `gerente_djt` - National manager
  - `gerente_divisao_djtx` - Division manager
  - `coordenador_djtx` - Coordinator
  - `lider_equipe` - Team leader
  - `conteudista` - Content creator
  - `curador_conteudo` - Content curator
  - `analista_financeiro` - Finance analyst
  - Legacy: `gerente`, `lider_divisao`, `coordenador`

### Row-Level Security (RLS)
- Enabled on all major tables
- Policies enforce user/role-based access (e.g., leaders can update challenges, users can only edit own posts)
- Service role (admin key) bypasses RLS for server-side operations
- Public anon key used for client-side authenticated requests

### Storage
- **File Storage**: Supabase Storage buckets
  - `avatars` - User profile pictures
  - `attachments` - Forum post attachments
  - `evidence` - Challenge evidence submissions
  - `study_materials` - Learning resources

## AI & LLM Integration
- **OpenAI Client**: openai 6.25.0
- **Environment Variables**:
  - `OPENAI_API_KEY` - API key (server-side only)
  - `OPENAI_MODEL_FAST` - Fast model for simple tasks (default: gpt-5-2025-08-07)
  - `OPENAI_MODEL_PREMIUM` - Strong model for generation (default: gpt-5-2025-08-07)
  - `OPENAI_MODEL_VISION` - Vision/OCR model (optional, fallback to main model)
  - `OPENAI_MODEL_AUDIO` - Audio model (optional)
  - `OPENAI_TRANSCRIBE_MODEL` - Transcription (fallback: whisper-1)
  - `OPENAI_MODEL_STUDYLAB_CHAT` - Study assistant chat (fallback: gpt-5-nano-2025-08-07)
  - `OPENAI_TTS_MODEL` - Text-to-speech (e.g., gpt-4o-mini-tts)
  - `STUDYLAB_OPENAI_TIMEOUT_MS` - Timeout for StudyLab (default: 45000ms)
  - `STUDYLAB_WEB_SEARCH_TIMEOUT_MS` - Web search timeout (default: 12000ms)
  - `STUDYLAB_INLINE_IMAGE_BYTES` - Max image bytes for inline embedding (default: 1500000)

### AI Use Cases
- **Quiz Generation**: AI-draft questions, generate wrong answers, parse quiz text
- **Study Assistant**: StudyLab chat with web search fallback, PDF/document ingestion
- **Audio**: Transcription via Whisper or native OpenAI audio model
- **Text Processing**: Cleanup (grammar/punctuation), translation, hashtag suggestions
- **AI Assessment**: Forum post helpfulness/clarity/toxicity scoring
- **Content Suggestions**: Recommend related challenges, hashtags, topics

## File Processing
- **PDF Handling**: pdf-parse 2.4.5
- **Word Documents**: mammoth 1.11.0 (DOCX parsing)
- **Excel**: exceljs 4.4.0 (XLSX read/write)
- **Sanitization**: dompurify 3.3.1 (HTML/content sanitization)
- **JSON Repair**: jsonrepair 3.13.2 (Malformed JSON recovery)

## Internationalization (i18n)
- **Locale Management**: Custom i18n system in `/src/lib/i18n/`
- **Translation Files**: `/locales/` directory
- **Active Locale**: Stored in localStorage, fetched via `activeLocale.ts`
- **AI Translation**: Via OpenAI for dynamic content (descriptions, quiz answers)
- **Theme Support**: next-themes 0.4.6 for dark/light mode

## Development & Deployment Tools
- **Deployment Platform**: Vercel (serverless API hosting)
- **Deployment Config**: vercel.json with:
  - Rewrites for unified API routing
  - Security headers (X-Frame-Options, CSP, HSTS, etc.)
  - CORS configuration per origin
  - Cache control policies

### Development Scripts
- `npm run dev` - Vite dev server
- `npm run dev:vercel` - Vercel local dev with tracing
- `npm run build` - Type check + Vite build
- `npm run typecheck` - TypeScript validation only
- `npm run lint` - ESLint validation
- `npm run test` - Node test runner
- `npm run gate` - Full validation gate (typecheck + test + build + lint)
- `npm run i18n:check` - Validate translations
- `npm run i18n:ai:fill` - Auto-fill missing translations via AI
- `npm run sanity:backend` - Backend health check script
- `npm run seed:org` - Seed organization structure
- `npm run sync:operational-base` - Sync operational data

### Code Quality
- **Linter**: ESLint 9.39.3 with TypeScript support
- **Plugins**: react-hooks, react-refresh
- **Type Checking**: TypeScript with reduced strictness (noImplicitAny: false, noUnusedLocals: false, strictNullChecks: false)
- **Base Path Alias**: `@/` → `./src/`

## Network & Security
- **Security Headers** (Vercel):
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff
  - Content-Security-Policy: Restricted script/style/img/connect sources
  - Strict-Transport-Security: max-age=63072000 with preload
  - Permissions-Policy: Camera/microphone denied, geolocation/payment allowed
  - Referrer-Policy: strict-origin-when-cross-origin
  - Cross-Origin-Opener-Policy: same-origin

- **CORS**: Whitelist based on ALLOWED_ORIGINS env var, with Vercel preview fallback
- **Supabase Hosts**: Validated against expected project host
- **Connect Sources**: Supabase, OpenStreetMap Nominatim for maps

## Dependency Overrides
- glob@7.2.3 with minimatch@3.1.5 (security patch)
- web-streams-polyfill@4.2.0 (compatibility)
- underscore@1.13.8 (legacy support)

## Performance & Monitoring
- **Performance Debug**: Custom perf instrumentation via `/src/lib/perfDebug.ts`
- **Chunk Error Recovery**: Auto-reload on module chunk failures
- **AI Progress Tracking**: Store-based progress UI for async operations
- **Session Caching**: 5-minute cache for auth checks to reduce database load
- **Error Boundaries**: AppErrorBoundary for React error catching

## Development Environment Files
- `.env.example` - Template for required/optional env vars
- `.env.local` - Local overrides (not versioned)
- `.vercel.env.local` - Vercel-specific env (not versioned)
- `tsconfig.json` - Base TS config with lenient settings
- `tsconfig.app.json` - App-specific config (referenced)
- `tsconfig.node.json` - Node/build tool config (referenced)

## Summary Table

| Category | Technology | Version |
|----------|-----------|---------|
| Runtime | Node.js | 24.x |
| Language | TypeScript | 5.9.3 |
| Framework | React | 19.2.4 |
| Router | React Router | 7.13.1 |
| Build | Vite | 7.3.1 |
| UI Primitives | Radix UI | 1.1+ |
| Styling | Tailwind CSS | 4.2.1 |
| Forms | React Hook Form | 7.71.2 |
| Validation | Zod | 4.3.6 |
| Toasts | Sonner | 2.0.7 |
| Database | PostgreSQL | (Supabase) |
| Auth | Supabase Auth | (JWT) |
| BaaS | Supabase | 2.98.0 |
| Server | Vercel Functions | (Node) |
| AI | OpenAI | 6.25.0 |
| Data Layer | TanStack Query | 5.90.21 |
| Charts | Recharts | 3.7.0 |
| Maps | Leaflet | 1.9.4 |
| Icons | Lucide React | 0.577.0 |
