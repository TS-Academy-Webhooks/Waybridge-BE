# Contributing Guidelines

Welcome to **Group 43's** development guidelines!

This repository is one half of **Waybridge — Logistics Webhook Management Platform**, built as our **TS Academy Capstone Project**. Because Waybridge is a two-part ecosystem designed to complement each other as a cohesive whole, please follow these guidelines carefully to maintain architecture symmetry and avoid breaking cross-repository dependencies.

---

## 🚀 Branching Strategy

To maintain a clean delivery pipeline toward our final submission, please use a strict feature-branch workflow. **Do not commit directly to `main` or `develop`.**

* **`main`** - Production-ready, graded project milestones.
* **`develop`** - Main integration branch for our active sprint features.
* **Feature Branches** - Branch out from `develop` using our Group 43 conventions:
    * `frontend/feature-name` (e.g., `frontend/webhook-logs`)
    * `backend/feature-name` (e.g., `backend/retry-mechanism`)
    * `bugfix/issue-name`

---

## 🛠️ Getting Started

1. **Clone the Repository** and ensure you have the sister repository cloned locally if testing cross-platform functionality.
2. **Install dependencies** based on this repository's scope:
    * Frontend: `npm install` / `pnpm install`
    * Backend: Set up environment variables (`.env`) and initialize the server/database.
3. Create your feature branch off `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b frontend/your-feature
   ```

---

## 📝 Code Standards & Integration Quality

### Cross-Repository Compatibility
* **Always verify contracts:** If you alter an API payload schema in the backend repository or an expectation on the frontend, update the companion repository immediately to prevent breaking integration.

### Linting & Formatting
* Run the project's formatting tools before pushing your code to keep the code codebase uniform for evaluation.

### Commit Guidelines
We utilize **Conventional Commits** to keep our submission history clean and readable for TS Academy reviewers:
* `feat(frontend): implement webhook delivery log table`
* `fix(backend): resolve payload validation signature mismatch`
* `docs: update environment configuration steps`

---

## 🔀 Pull Request (PR) Process

When your task is complete, open a Pull Request against the **`develop`** branch.

1. **Cross-Reference:** State clearly if this PR requires a corresponding PR in the sister repository to function.
2. **Peer Review:** Assign at least one stack partner (Frontend/Backend) to audit your code.
3. **Validation:** Ensure all automated linting, test suites, and build checks clear completely before requesting a merge.

---
Thank you for your hard work, Group 43! Let's build an excellent Capstone Project.
