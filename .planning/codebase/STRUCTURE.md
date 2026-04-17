# DJT Quest Directory Structure & Module Organization

## Root Directory Overview

```
djt-quest/
├── api/                          # Vercel serverless API routers (12 files)
├── server/                       # Server-side logic & handlers
│   ├── api-handlers/             # 75+ modular request handlers
│   ├── lib/                      # Server utilities (AI, OpenAI, etc.)
│   └── env-guard.js              # Environment validation
├── src/                          # Frontend React application
│   ├── pages/                    # Route components (20+ files)
│   ├── components/               # React components (70+ files)
│   ├── contexts/                 # Context providers (auth, i18n)
│   ├── hooks/                    # Custom hooks
│   ├── lib/                      # Frontend utilities & business logic
│   ├── integrations/             # Third-party integrations (Supabase)
│   ├── content/                  # Static content data
│   ├── assets/                   # Images, fonts
│   ├── App.tsx                   # Root component
│   ├── main.tsx                  # Entry point
│   └── index.css                 # Global styles
├── supabase/
│   └── migrations/               # 90+ SQL migration files
├── locales/                      # i18n translation files (10+ languages)
├── scripts/                      # Utility & maintenance scripts (20+)
├── docs/                         # Documentation
├── types/                        # TypeScript type definitions
├── .vercel/                      # Vercel project config
├── dist/                         # Build output (gitignored)
├── .planning/                    # GSD work planning
├── package.json                  # Dependencies & scripts
├── vercel.json                   # Vercel deployment config
├── vite.config.ts                # Vite build config
├── tsconfig.json                 # TypeScript config (root)
├── tsconfig.app.json             # TS config for app
├── tsconfig.node.json            # TS config for build tools
├── eslint.config.js              # ESLint rules
├── components.json               # shadcn/ui config
├── tailwind.config.ts            # Tailwind CSS config (stub)
├── index.html                    # SPA entry HTML
├── .env.example                  # Environment template
├── .env.local                    # Local overrides (gitignored)
├── .vercel.env.local             # Vercel env (gitignored)
├── .gitignore                    # Git exclude patterns
├── README.md                     # Project overview
├── CHANGELOG.md                  # Release notes
├── UPDATE_REPORT.md              # Recent changes summary
└── bun.lockb                     # Bun lock file (alternative to npm)
```

---

## api/ - Vercel Serverless Routers

**Purpose**: Entry points for HTTP endpoints, dispatching to modular handlers

**Files** (12 routers):

```
api/
├── auth-login.ts               # POST - Email/password JWT auth
├── admin.ts                    # POST - Admin user operations
├── ai.ts                       # POST - AI/LLM dispatcher (15+ handlers)
├── register.ts                 # POST - User registration & approval
├── sepbook.ts                  # POST - Social feed operations
├── forum.ts                    # POST - Forum topic/post operations
├── campaign.ts                 # POST - Campaign management
├── finance.ts                  # POST - Finance request handling
├── study.ts                    # POST - Study materials & chat
├── tts.ts                      # POST - Text-to-speech audio generation
├── misc.ts                     # POST - Misc endpoints (rankings, challenges, etc.)
└── version.ts                  # GET - Version/build info
```

### Router Pattern Example

```typescript
// api/sepbook.ts
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action || req.body?.action;
  
  const handlers: Record<string, () => Promise<...>> = {
    'post': () => import('../server/api-handlers/sepbook-post.js'),
    'comments': () => import('../server/api-handlers/sepbook-comments.js'),
    'feed': () => import('../server/api-handlers/sepbook-feed.js'),
    'likes': () => import('../server/api-handlers/sepbook-likes.js'),
    // ... more
  };
  
  const loader = handlers[action];
  if (!loader) return res.status(400).json({ error: 'Unknown action' });
  
  const mod = await loader();
  return await mod.default(req, res);
}
```

### Key Router Features
- **CORS Handling**: Origin validation in auth-login.ts, ai.ts
- **Request Validation**: Check auth headers, body params
- **Error Handling**: Try/catch with 500 fallback
- **Config**: maxDuration=60s, bodyParser limit=20MB

---

## server/ - Backend Logic

### server/api-handlers/ - Request Handlers (75+ files)

**Organization by Domain**:

#### AI Handlers (15 files)
```
ai-health.ts                   # Health check / diagnostics
ai-quiz-draft.ts               # Generate single quiz question
ai-quiz-milhao.ts              # Who Wants to Be a Millionaire quiz
ai-quiz-burini.ts              # Burini quiz variant
ai-generate-wrongs.ts          # Generate wrong answer options
ai-generate-wrongs-batch.ts    # Batch wrong answer generation
ai-parse-quiz-text.ts          # Parse raw text into quiz structure
ai-study-quiz.ts               # Generate study practice quiz
ai-study-chat.ts               # StudyLab AI conversational assistant
transcribe-audio.ts            # Audio to text transcription
ai-translate-text.ts           # Translate dynamic content
ai-suggest-hashtags.ts         # Suggest topic hashtags (JSON)
forum-cleanup-text.ts          # Grammar & orthography correction
ai-proofread-ptbr.ts           # Portuguese-BR proofreading
[others]
```

#### Forum Handlers (12 files)
```
forum-create-topic.ts          # Create discussion topic
forum-post.ts                  # Create forum post
forum-react.ts                 # Post reactions (like, helpful, etc.)
forum-like.ts                  # Legacy like handler
forum-moderate.ts              # Moderation (delete, flag)
forum-curate-topic.ts          # Curator operations
forum-close-topic.ts           # Close topic for discussion
forum-ai-assess-post.ts        # AI scoring (helpfulness, clarity, etc.)
forum-apply-monthly-bonus.ts   # Bonus XP from forum contributions
forum-monthly-rollup.ts        # Monthly metrics calculation
forum-top-insights.ts          # Trending posts/insights
forum-translate.ts             # Translate forum content
```

#### SEPBook Handlers (15 files)
```
sepbook-post.ts                # Create social post
sepbook-comments.ts            # Comment on posts
sepbook-comment-gps.ts         # Comment with GPS (Guardiao Vida)
sepbook-feed.ts                # Fetch feed (timeline)
sepbook-likes.ts               # Like posts/comments
sepbook-react.ts               # Reactions (not just likes)
sepbook-trending.ts            # Trending posts
sepbook-summary.ts             # Personal/team summary
sepbook-tags.ts                # Tag management
sepbook-mention-suggest.ts     # @mention autocomplete
sepbook-mentions.ts            # User mentions (inbox)
sepbook-mentions-inbox.ts      # Mention notification inbox
sepbook-mentions-mark-seen.ts  # Mark mentions as read
sepbook-mark-seen.ts           # Mark posts/comments as seen
sepbook-moderate.ts            # Moderation & deletion
```

#### Admin Handlers (12 files)
```
admin-update-profile.ts        # Update user profile fields
admin-adjust-xp.ts             # Adjust user XP directly
admin-reset-milhao-attempts.ts # Reset quiz attempts
admin-fix-challenge-targets.ts # Fix challenge targets
approve-registration.ts        # Approve pending users
reject-registration.ts         # Reject registration
request-password-reset.ts      # Initiate password reset
review-password-reset.ts       # Verify & complete reset
_generateTempPassword.ts        # Generate temp password
studio-create-user.ts          # Create user account
studio-update-user.ts          # Update user account
studio-pending-counts.ts       # Count pending items
```

#### Challenge & Evaluation Handlers (11 files)
```
challenges-delete.ts           # Delete challenge
challenges-update-status.ts    # Update submission status
challenge-action-submit.ts     # Submit evidence/action
challenge-evidence.ts          # Evidence handling (alt)
challenge-targets.ts           # Challenge target management
leadership-challenges.ts       # Leadership challenge logic
event-evaluators.ts            # Assign evaluators
evaluations.ts                 # Evaluation workflow
admin-fix-challenge-targets.ts # Admin fixes
coord-ranking.ts               # Coordinator ranking
coord-ranking-bonus.ts         # Bonus calculations
coord-ranking-summary.ts       # Ranking summaries
```

#### Campaign & Finance Handlers (10 files)
```
campaign-evidence-submit.ts    # Campaign evidence submission
campaign-evidence.ts           # Campaign evidence retrieval
campaign-stats.ts              # Campaign metrics
campaign-suggest.ts            # Campaign suggestions
campaign-links.ts              # Campaign asset links
finance-request.ts             # Submit finance request
finance-request-extract.ts     # Extract data from documents
finance-requests.ts            # List requests (user view)
finance-requests-admin.ts      # Admin review interface
finance-approve.ts             # Approve/reject request
```

#### Study & Learning Handlers (8 files)
```
study-sources.ts               # Fetch learning materials
study-source-upload.ts         # Upload study material
study-source-delete.ts         # Remove material
study-chat.ts                  # (merged with ai-study-chat.ts)
ai-study-chat.ts               # Study assistant conversation
study-sources-search.ts        # Full-text search
study-suggest-topics.ts        # Recommend topics
study-trending.ts              # Trending materials
```

#### Quiz & Learning Handlers (8 files)
```
quiz-practice-check.ts         # Check practice quiz answers
quiz-xp-tiers.ts               # Quiz XP tier mapping
quiz-attempts.ts               # Quiz attempt history
quiz-question-import.ts        # Bulk question import
studio-create-quiz-question.ts # Create question (curator)
studio-publish-quiz-milhao.ts  # Publish Millionaire quiz
quiz-best-of-milhao.ts         # Best score tracking
quiz-results-export.ts         # Export results
```

#### Utility Handlers (6 files)
```
reverse-geocode.ts             # Convert GPS to address
profile-lookup.ts              # Search user by name/email
registration-options.ts        # Get registration choices
guardiao-vida-dashboard.ts     # Guardiao Vida stats
sanity-check.ts                # Health/diagnostic
import-data.ts                 # Bulk data import
```

#### Content & Curation Handlers (5 files)
```
sepbook-backfill-translations.ts  # Auto-translate posts
forum-translate.ts                # Translate topics/posts
content-review.ts                 # Content moderation queue
content-suggestions.ts            # AI content ideas
studio-list-pending-registrations.ts # Pending users
```

### server/lib/ - Shared Server Utilities

```
server/lib/
├── ai-proofread-ptbr.ts       # PT-BR proofreading logic
├── openai.ts                  # OpenAI API wrapper
├── auth.ts                    # JWT validation utilities
├── db.ts                      # Database query helpers
├── storage.ts                 # Supabase storage operations
└── [other utilities]
```

### server/env-guard.js
- Validates required environment variables
- Called by all API handlers
- Ensures OPENAI_API_KEY, SUPABASE_URL, etc. are set

---

## src/ - Frontend React Application

### src/pages/ - Route Components (20+ files)

**User-Facing Pages**:
```
pages/
├── Home.tsx                    # Landing / dashboard selection
├── Auth.tsx                    # Login / password reset UI
├── Register.tsx                # User registration form
├── NotFound.tsx                # 404 page
├── UserSetup.tsx               # First-time user setup
│
├── Dashboard.tsx               # Main dashboard (role-based)
├── Profile.tsx                 # User profile & settings
├── Rankings.tsx                # Leaderboards & rankings
│
├── Study.tsx                   # Study materials & AI tutor (StudyLab)
├── Challenges.tsx              # Leadership challenges list
├── ChallengeDetail.tsx         # Single challenge detail + submit
│
├── Forums.tsx                  # Forum topics list
├── ForumTopic.tsx              # Single topic discussion
├── ForumInsights.tsx           # Forum analytics/insights
│
├── SEPBook.tsx                 # Social feed (legacy layout)
├── SEPBookIG.tsx               # Social feed (Instagram-like layout)
│
├── Evaluations.tsx             # Leadership evaluation assignment
│
├── Studio.tsx                  # Quiz creation & curation (curators only)
├── StudioCuration.tsx          # Content curation hub
│
├── CampaignDetail.tsx          # Campaign details & participation
│
├── LeaderDashboard.tsx         # Leader team performance view
├── FinanceRequests.tsx         # Finance request workflow
│
└── [others]
```

**Page Features**:
- Lazy-loaded via React.lazy() in App.tsx
- Protected by ProtectedRoute wrapper
- Use AuthContext for role checking
- Fetch data via apiFetch() + TanStack Query

### src/components/ - React Components (70+ files)

**Structure**:
```
components/
├── ui/                         # shadcn/ui Primitives (40+ files)
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── form.tsx
│   ├── input.tsx
│   ├── card.tsx
│   ├── tabs.tsx
│   ├── select.tsx
│   ├── checkbox.tsx
│   ├── switch.tsx
│   ├── dropdown-menu.tsx
│   ├── context-menu.tsx
│   ├── popover.tsx
│   ├── tooltip.tsx
│   ├── accordion.tsx
│   ├── collapsible.tsx
│   ├── navigation-menu.tsx
│   ├── pagination.tsx
│   ├── scroll-area.tsx
│   ├── avatar.tsx
│   ├── badge.tsx
│   ├── chart.tsx
│   ├── carousel.tsx
│   ├── command.tsx
│   ├── calendar.tsx
│   ├── input-otp.tsx
│   ├── progress.tsx
│   ├── slider.tsx
│   ├── radio-group.tsx
│   ├── toggle.tsx
│   ├── toggle-group.tsx
│   ├── toast.tsx
│   ├── sonner.tsx
│   ├── resizable.tsx
│   ├── separator.tsx
│   └── [more primitives]
│
├── [Domain-specific Components] (30+ files)
│   ├── ProtectedRoute.tsx      # Auth guard wrapper
│   ├── CompleteProfile.tsx     # Profile completion modal
│   ├── AppErrorBoundary.tsx    # Error boundary
│   │
│   ├── ProfileEditor.tsx       # Edit user profile
│   ├── AvatarDisplay.tsx       # Display user avatar
│   ├── AvatarCapture.tsx       # Avatar upload/capture
│   ├── AvatarRegistrationTool.tsx # Avatar during registration
│   │
│   ├── ChallengeForm.tsx       # Create/edit challenge
│   ├── ChallengeDetail.tsx     # Challenge display + evidence form
│   │
│   ├── CampaignForm.tsx        # Create campaign
│   ├── CampaignManagement.tsx  # Campaign admin panel
│   │
│   ├── ForumKbThemeSelector.tsx # Forum theme/knowledge base selector
│   ├── ForumKbThemeMenu.tsx    # Theme menu dropdown
│   │
│   ├── StudioDashboard.tsx     # Curator dashboard
│   ├── StudioMaintenance.tsx   # Studio admin tools
│   ├── StudioWelcomeToast.tsx  # Welcome notification
│   │
│   ├── TeamPerformanceCard.tsx # Team performance metrics
│   ├── TeamPerformanceManager.tsx # Team admin view
│   ├── TeamEventForm.tsx       # Create team event
│   │
│   ├── LeaderTeamDashboard.tsx # Leader view of team
│   │
│   ├── AdminBonusManager.tsx   # Manage XP bonuses
│   ├── PendingApprovals.tsx    # Registration approvals
│   ├── PendingRegistrationsManager.tsx # Reg management
│   ├── UserApprovalsHub.tsx    # User approval interface
│   │
│   ├── EvaluationManagement.tsx # Evaluation assignment UI
│   │
│   ├── TierBadge.tsx           # Display tier/level badge
│   ├── TierProgressCard.tsx   # XP progress display
│   ├── TeamTierProgressCard.tsx # Team tier progress
│   │
│   ├── VoiceRecorderButton.tsx # Audio recording UI
│   ├── TtsPlayerBar.tsx        # Text-to-speech player
│   │
│   ├── AttachmentUploader.tsx  # File upload component
│   ├── AttachmentViewer.tsx    # File preview
│   ├── AttachmentMetadataModal.tsx # Attachment info
│   │
│   ├── AiProgressOverlay.tsx   # AI task progress UI
│   ├── AIStatus.tsx            # AI status indicator
│   │
│   ├── SepbookGpsConsentPrompt.tsx # GPS permission prompt
│   ├── ForumMentionsInbox.tsx  # Mentions notification center
│   ├── UserProfilePopover.tsx  # Profile card popover
│   │
│   ├── BootstrapManager.tsx    # App initialization
│   ├── RouteRefreshManager.tsx # Route change handler
│   ├── SystemHealthCheck.tsx   # System status check
│   │
│   ├── ContentHub.tsx          # Content discovery
│   ├── CompendiumPicker.tsx    # Knowledge base selector
│   │
│   ├── TipDialogButton.tsx     # Game tips modal
│   ├── HelpInfo.tsx            # Contextual help
│   │
│   ├── PasswordResetManager.tsx # Reset password flow
│   ├── PhoneConfirmation.tsx   # Phone verification
│   ├── InitialUserImport.tsx   # Bulk user import
│   │
│   └── [more domain components]
│
├── profile/
│   ├── MyCreatedQuizzesCard.tsx # User's quizzes
│   ├── UserFeedbackInbox.tsx   # Feedback messages
│   ├── ForumMentions.tsx       # Forum mentions inbox
│   ├── SepbookPostsCard.tsx    # User's social posts
│   ├── ActionReviewCard.tsx    # Action review
│   ├── ProfileChangeHistory.tsx # Change log
│   ├── LearningDashboard.tsx   # Learning progress
│   ├── ChangePasswordCard.tsx  # Password change
│   ├── RetryModal.tsx          # Retry failed action
│   └── [other profile subcomponents]
│
└── SendUserFeedbackDialog.tsx  # Feedback form
```

### src/contexts/ - React Context Providers (2+ files)

```
contexts/
├── AuthContext.tsx             # User auth, roles, profile, session
│   ├── UserProfileData type
│   ├── OrgScope type
│   ├── useAuth() hook
│   ├── Session caching (5-min TTL)
│   ├── Role override (dev feature)
│   └── Session locking (emergency)
│
├── I18nContext.tsx             # Locale & translations
│   ├── useI18n() hook
│   ├── t() for translation strings
│   ├── Locale switching
│   └── Dynamic AI translation support
│
└── [others]
```

### src/lib/ - Frontend Utilities (26+ files)

**Organization**:
```
lib/
├── api.ts                      # apiFetch() - HTTP client with auth
│   ├── Token injection from Supabase session
│   ├── AI progress tracking via aiProgressStore
│   ├── Silent mode support (X-AI-UI header)
│   └── Error handling
│
├── auth-login.ts               # Custom login handler
├── biometricAuth.ts            # Fingerprint/biometric fallback
│
├── sfx/                        # Sound effects system
│   └── index.ts                # SfxProvider, useSfx hook
│
├── tts/                        # Text-to-speech integration
│   └── index.ts                # TtsProvider, TtsPlayer
│
├── i18n/
│   ├── activeLocale.ts         # Current locale management
│   ├── aiTranslate.ts          # AI translation helper
│   ├── language.ts             # Language mapping
│   └── [locale files]
│
├── forum/                      # Forum utilities
│   └── fetchKbSnippets.ts      # Knowledge base search
│   └── hashtagTree.ts          # Hashtag hierarchy
│
├── finance/                    # Finance module
│   └── constants.ts            # Finance types/enums
│
├── constants/                  # App constants
│   ├── tiers.ts                # XP tier definitions
│   ├── points.ts               # XP point values
│   ├── milhaoLevels.ts         # Quiz difficulty mapping
│   └── [other constants]
│
├── validations/                # Zod schemas
│   ├── challenge.ts            # Challenge form schema
│   └── quiz.ts                 # Quiz form schema
│
├── utils.ts                    # General utilities (clsx, etc.)
├── utils/
│   ├── tierCalculations.ts     # Tier/XP calculations
│   └── [other utils]
│
├── sanitize.ts                 # HTML sanitization (DOMPurify)
├── profileCompletion.ts        # Check required profile fields
├── operationalBase.ts          # Org structure helpers
├── teamLookup.ts               # Team/division lookup
├── phone.ts                    # Phone validation
├── whatsappShare.ts            # WhatsApp share & canonical origin
├── quizScore.ts                # Quiz scoring logic
├── dateKey.ts                  # Date key generation
├── adminAllowlist.ts           # Admin user list
├── aiProgress.ts               # AI task progress store
├── chunkErrorReload.ts         # Module reload on error
├── perfDebug.ts                # Performance instrumentation
└── [other utilities]
```

### src/integrations/ - Third-Party Integrations

```
integrations/
└── supabase/
    ├── client.ts               # Supabase JS client instance
    │   ├── Project hardcoding (security validation)
    │   ├── Auto-refresh tokens
    │   ├── localStorage session persistence
    │   └── Error diagnostics
    │
    └── types.ts                # Auto-generated DB types
        ├── Tables & definitions
        ├── User-facing enums
        └── [all schema types]
```

### src/content/ - Static Content

```
content/
└── game-tips.ts                # Game tips/hints data
```

### src/assets/ - Images & Fonts

```
assets/
├── images/                     # PNG, JPG, SVG
├── fonts/                      # Custom fonts
└── [other assets]
```

### src/App.tsx - Root Application Component

**Key Features**:
- React Router setup with 20+ routes
- Lazy-loaded page components
- AuthProvider, I18nProvider wrapping
- Theme provider (next-themes)
- Query client setup (TanStack Query)
- Global providers (Tooltip, Toast, SFX, TTS)
- ProfileCheckWrapper for completion gate
- ProtectedRoute for role-based access

### src/main.tsx - Entry Point

**Initialization**:
- Chunk error auto-reload
- Performance debugging setup
- Canonical origin check (whatsappShare)
- React root rendering

### src/index.css - Global Styles

- Tailwind CSS directives (@tailwind)
- Custom CSS variables
- Global component overrides
- Dark mode support

---

## supabase/ - Database Migrations

**Location**: `supabase/migrations/`

**Migration Count**: 90+ files (~15k lines SQL)

**Organization**:
```
migrations/
├── 20251023*.sql               # Early schema setup
├── 202511041*.sql              # Core tables (profiles, org, auth)
├── 202511061*.sql              # Bootstrap (backend setup)
├── 202511081*.sql              # Date of birth field
├── 202511101*.sql              # Challenges, evaluations, organization
├── 202511111*.sql              # Forum & quiz systems
├── 20251115*.sql               # SEPBook social feed
├── 202511171*.sql              # Content management
├── 20251120*.sql               # Challenge evidence
├── 20251121*.sql               # Study sources, full-text search
├── 20251126*.sql               # Security & RLS policies
├── 202512151*.sql              # Reward modes, finance
├── 202512161*.sql              # Data integrity & lint fixes
├── 202512171*.sql              # Curation imports, quiz imports
├── 202512181*.sql              # Translations, TTS, SFX, locale
├── 202512191*.sql              # Quiz optimization, RLS performance
├── 202512201*.sql              # SEPBook read policies
├── 202512211*.sql              # Translations, forum translations
├── 202512231*.sql              # Knowledge base, hashtags
├── 202512241*.sql              # Study source expiry
├── 202512311*.sql              # Comment attachments
├── 20260101*.sql               # SEPBook translations
├── 20260103*.sql               # Campaign links, evaluation queue
├── 20260105*.sql               # User mention handle
├── 20260106*.sql               # Study chat sessions, security fixes
└── [continued...]
```

**Schema Coverage**:
- Authentication & users
- Organizational hierarchy
- Quiz & learning
- Forum & community
- Social feed (SEPBook)
- Challenges & evaluations
- Finance & campaigns
- Study materials
- Notifications & metadata

---

## locales/ - Internationalization

**Purpose**: Translation files for multilingual UI

**Structure**:
```
locales/
├── pt-BR.json                  # Portuguese (Brazil) - Primary
├── en.json                     # English
├── es.json                     # Spanish
├── fr.json                     # French
└── [other languages]
```

**Key Translation Groups**:
- `common` - UI labels, buttons
- `pages` - Page titles
- `errors` - Error messages
- `validations` - Form validation messages
- `quiz` - Quiz terminology
- `forum` - Forum labels
- `challenges` - Challenge descriptions
- `finance` - Finance workflow
- `evaluation` - Evaluation terminology

**Dynamic Translation**:
- Missing translations auto-filled via `scripts/i18n-ai-fill.mjs`
- Audit via `scripts/i18n-audit.mjs`

---

## scripts/ - Utility & Maintenance Scripts (20+ files)

**Data Management**:
```
scripts/
├── reset-and-import.mjs        # Reset DB and import data
├── sync-operational-base.mjs   # Sync operational data
├── seed-org-structure.mjs      # Seed org hierarchy
├── cleanup-simulated-divisions.mjs # Remove test data
├── cleanup-teams.mjs           # Team cleanup
├── resanitize-org.mjs          # Fix org data
├── backfill-date-of-birth.mjs  # Fill missing DOB
├── ensure-daniel-curator.mjs   # Ensure curator user exists
├── download-avatars.mjs        # Download user avatars
│
├── i18n-check.mjs              # Validate translations
├── i18n-ai-fill.mjs            # Auto-translate missing strings
├── i18n-audit.mjs              # Audit translation completeness
│
├── sanity-check.mjs            # System health check
├── release-prod.mjs            # Release automation
├── lint-gate.mjs               # ESLint enforcement
│
└── [other scripts]
```

---

## Configuration Files

### Root Config Files
```
package.json                    # Dependencies, scripts, Node version (24.x)
package-lock.json              # Lock file (npm)
bun.lockb                       # Lock file (bun)
vite.config.ts                 # Vite build config (vendor chunking)
tsconfig.json                  # TypeScript root config (lenient)
tsconfig.app.json              # App TypeScript config
tsconfig.node.json             # Build tools TypeScript config
eslint.config.js               # ESLint rules
components.json                # shadcn/ui metadata
tailwind.config.ts             # Tailwind CSS (stub, CSS-first in index.css)
index.html                     # SPA entry
```

### Environment Files
```
.env.example                    # Template (versioned)
.env.local                      # Local overrides (gitignored)
.vercel.env.local              # Vercel-specific (gitignored)
.node-version                  # Node version (24.x)
.nvmrc                         # NVM version file
```

### Vercel Config
```
vercel.json                    # Rewrites, headers, cache control, CORS
.vercel/                       # Vercel project metadata
```

### Git & CI
```
.gitignore                     # Git exclude patterns
.github/                       # GitHub actions/templates
```

### Code Quality
```
.eslintignore                  # ESLint exclusions
prettier.config.js             # (optional) Prettier formatting
```

---

## Build Output

### dist/ Directory (Generated)
```
dist/
├── index.html                 # Built SPA entry
├── assets/                    # Chunk files
│   ├── index-XXXXX.js         # Main app chunk
│   ├── vendor-react-XXXXX.js  # React vendor chunk
│   ├── vendor-ui-XXXXX.js     # UI components chunk
│   ├── vendor-data-XXXXX.js   # Data fetching chunk
│   ├── vendor-forms-XXXXX.js  # Form libraries chunk
│   ├── vendor-maps-XXXXX.js   # Leaflet/maps chunk
│   ├── vendor-charts-XXXXX.js # Recharts chunk
│   ├── vendor-dates-XXXXX.js  # Date utilities chunk
│   ├── vendor-misc-XXXXX.js   # Misc libraries chunk
│   └── style-XXXXX.css        # Combined CSS
└── [sourcemaps if enabled]
```

---

## Documentation

### docs/ - Project Documentation
```
docs/
├── README.md                   # Getting started
├── ARCHITECTURE.md             # System design
├── API.md                      # API endpoints
├── DATABASE.md                 # Schema docs
├── DEPLOYMENT.md               # Deployment guide
├── CONTRIBUTING.md             # Contribution guidelines
└── [other docs]
```

### Project Documentation
```
README.md                       # Project overview
CHANGELOG.md                    # Release history
UPDATE_REPORT.md                # Recent changes summary
```

---

## Module Responsibilities Summary

| Module | Responsibility | Tech |
|--------|-----------------|------|
| **api/** | Route dispatch | Vercel Functions |
| **server/api-handlers/** | Business logic | Node.js, OpenAI, Supabase |
| **src/pages/** | Route components | React Router |
| **src/components/** | UI components | React, Radix UI, Tailwind |
| **src/contexts/** | State management | React Context |
| **src/lib/** | Utilities & logic | TypeScript utilities |
| **src/integrations/** | External services | Supabase SDK |
| **supabase/migrations/** | Database schema | PostgreSQL SQL |
| **locales/** | Translations | JSON i18n files |
| **scripts/** | Maintenance | Node.js scripts |
| **types/** | TS declarations | TypeScript |
| **vercel.json** | Deployment | Vercel config |
| **vite.config.ts** | Build pipeline | Vite config |

---

## File Count Summary

| Directory | Count | Type |
|-----------|-------|------|
| src/pages/ | 20 | React components |
| src/components/ | 70+ | React components |
| src/components/ui/ | 40+ | shadcn/ui components |
| src/lib/ | 26+ | Utility modules |
| api/ | 12 | Vercel routers |
| server/api-handlers/ | 75+ | Handler implementations |
| supabase/migrations/ | 90+ | SQL migrations |
| scripts/ | 20+ | Maintenance scripts |
| locales/ | 10+ | Translation files |
| **Total TS/TSX** | 350+ | Frontend + backend |
| **Total SQL** | 15k+ lines | Database |

---

## Development Workflow

### Local Development
```bash
npm run dev                     # Vite dev + local API
npm run dev:vercel            # Vercel local dev
npm run typecheck             # TypeScript validation
npm run lint                  # ESLint
npm run test                  # Node tests
npm run gate                  # Full QA (typecheck + test + build + lint)
```

### Build & Deploy
```bash
npm run build                 # Production build
npm run preview              # Preview production build
# Push to Vercel via git integration
```

### Database
```bash
# Migrations applied automatically on Vercel deploy
# Local Supabase: supabase db push
# Supabase CLI: supabase migration list
```

