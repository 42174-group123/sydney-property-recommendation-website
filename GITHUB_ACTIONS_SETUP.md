# GitHub Actions and Vercel Setup

This repo is set up so GitHub Actions can show CI/CD evidence:

- `.github/workflows/frontend-ci.yml` runs linting, TypeScript checking, a smoke test, and a production build.
- `.github/workflows/vercel-deploy.yml` is an optional manual Vercel CLI deployment workflow. You only need this if you decide to deploy from GitHub Actions instead of using Vercel's normal GitHub import integration.

## 1. One-Time Local Prep

From the frontend folder, install Nitro once so `package-lock.json` is updated before your first commit:

```bash
cd "/Users/ryanluo/Documents/ai project/stay-scout"
npm install --save-dev nitro@3.0.260429-beta
```

Then run:

```bash
npm run ci
```

If the build is slow locally, you can still push and let GitHub Actions run it on a clean Linux runner.

## 2. Create the GitHub Repository

Create a new empty GitHub repository, then run:

```bash
cd "/Users/ryanluo/Documents/ai project"
git status
git add .
git commit -m "ci: add GitHub Actions and Vercel deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

Do not commit `.env`, `.venv`, `node_modules`, `dist`, `.vercel`, or ClearML/Supabase secret files. The root `.gitignore` and nested `.gitignore` files are set up to avoid those.

## 3. Deploy with Vercel's GitHub Integration

This is the easiest path and does not need `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID`.

1. Push this repository to GitHub.
2. In Vercel, click `New Project`.
3. Choose `Continue with GitHub`.
4. Import `42174-group123/sydney-property-recommendation-website`.
5. Set the frontend root directory to:

```text
stay-scout
```

6. Add the environment variables from the next section.
7. Deploy.

After the first import, Vercel will deploy again automatically whenever you push to the production branch.

## 4. Add Vercel Environment Variables

In Vercel project settings, add these environment variables:

```text
VITE_SUPABASE_URL=https://rmonjbexchkyvkgecacn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
VITE_SUPABASE_PROJECT_ID=rmonjbexchkyvkgecacn
SUPABASE_URL=https://rmonjbexchkyvkgecacn.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
ML_BACKEND_URL=https://your-public-ml-inference-api-url
NITRO_PRESET=vercel
```

For production match-score filtering, `ML_BACKEND_URL` must be a public URL. A local `http://127.0.0.1:8090` backend only works on your own machine.

## 5. Optional: Deploy from GitHub Actions Instead

You do not need this for the normal Vercel GitHub import flow. Only use it if your marker specifically wants the GitHub Actions workflow itself to perform the Vercel deployment.

Install and log in to Vercel CLI:

```bash
npm install --global vercel@latest
cd "/Users/ryanluo/Documents/ai project/stay-scout"
vercel login
vercel link
```

Open the generated `.vercel/project.json` locally and copy:

- `orgId`
- `projectId`

Do not commit the `.vercel` folder.

Then add GitHub secrets.

In GitHub:

`Repository -> Settings -> Secrets and variables -> Actions -> New repository secret`

Add:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

`VERCEL_TOKEN` comes from your Vercel account settings. `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` come from `.vercel/project.json`.

## 6. OAuth URLs After Deployment

After Vercel gives you a production URL, add it to Supabase:

```text
Site URL:
https://YOUR_PROJECT.vercel.app

Redirect URLs:
https://YOUR_PROJECT.vercel.app
https://YOUR_PROJECT.vercel.app/**
```

In Google Cloud OAuth, add:

```text
Authorized JavaScript origin:
https://YOUR_PROJECT.vercel.app

Authorized redirect URI:
https://rmonjbexchkyvkgecacn.supabase.co/auth/v1/callback
```

## 7. What Happens on GitHub

When you push to `main`:

1. GitHub Actions runs linting, typecheck, smoke test, and build.
2. Vercel's GitHub integration detects the same push and creates a deployment.
3. The GitHub repository shows CI evidence, and the Vercel dashboard shows deployment evidence.

When you open a pull request:

1. GitHub Actions runs the same checks.
2. Vercel creates a preview deployment for the branch.
