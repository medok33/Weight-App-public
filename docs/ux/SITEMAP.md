# Sitemap

```text
Public
├── /
├── /how-it-works
├── /pricing
├── /legal/offer
└── /legal/privacy
Auth
├── /sign-in
├── /sign-up
└── /auth/callback/:provider
App
├── /today
├── /plan
├── /tracking
├── /progress
└── /settings
Safety
├── /screening
└── /safety/blocked
```

Public pages are crawlable and never expose account or health data. App routes
require a session and the safety gate before personalized content.
