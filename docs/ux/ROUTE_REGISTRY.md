# Route registry

| Route | Access | Feature | Primary state |
|---|---|---|---|
| `/` | Public | Landing | success |
| `/pricing` | Public | Payments | success |
| `/sign-in` | Public | Auth | loading/error |
| `/today` | Session + eligible | Dashboard | loading/empty/error/success |
| `/screening` | Session | Eligibility | loading/error/success |
| `/tracking` | Session + consent | Tracking | loading/empty/error/success |
| `/settings` | Session | User profile/privacy | loading/error/success |

Route contracts are versioned at the API boundary and future iOS/Android
clients consume the same domain routes, not web internals.
