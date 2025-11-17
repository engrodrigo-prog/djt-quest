# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/28f86751-0548-411b-bdca-e0df24d02def

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/28f86751-0548-411b-bdca-e0df24d02def) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Backend (Supabase)

This repo ships with a Supabase backend (Edge Functions + SQL migrations) designed to work from scratch.

Quick start locally:

1) Install Supabase CLI: `npm i -g supabase`
2) Start local stack: `supabase start`
3) Link your project (optional): `supabase link --project-ref <your-ref>`
4) Apply database schema: `supabase db reset` (or `supabase db push`)
5) Serve functions locally:

```
supabase functions serve --env-file .env --no-verify-jwt
```

Key pieces:

- SQL schema/migrations: `supabase/migrations/`
- Public storage bucket for avatars created by migration (id: `avatars`)
- Edge functions used by the app:
  - `studio-import-initial-users`: importa/atualiza usuários e papéis
  - `studio-cleanup-users`: remove usuários de teste/indesejados
  - `studio-update-user`: atualiza campos e função/role

Environment variables expected by functions (when serving locally):

```
SUPABASE_URL=...        # http://127.0.0.1:54321 for local
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

To reseed org structure or data, check scripts in `scripts/`.

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/28f86751-0548-411b-bdca-e0df24d02def) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
