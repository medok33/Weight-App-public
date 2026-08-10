# V10 responsive matrix

Exact decorative spacing may be `TBD_OWNER_VISUAL`; the navigation, task order, safe-area and overflow rules below are not TBD.

| Widths | Navigation / screen padding / content width | Columns, CTA and images | Sheet, sticky, overflow and type |
|---|---|---|---|
| 360, 375, 390, 430 | Mobile top bar + fixed five tabs; V10 mobile gutter, safe-area bottom clearance; one readable column | Next action then Why now then one CTA; meals distinct; image above copy or omitted | Bottom sheet; dialog only when a sheet is unsuitable; keyboard must not hide action; nav never covers final control; wrap RU text and reduce hierarchy before truncation |
| 768, 834 | Compact rail; constrained canvas with V10 tablet gutter | One column by default; two columns only when decision copy and controls retain width; CTA remains with decision | Adaptive sheet/dialog; no page horizontal overflow; sticky rail never covers content; labels wrap |
| 1024 | Compact-to-persistent sidebar transition; editorial canvas, bounded line length | Two columns permitted; metrics secondary, media contained | Centered dialog; sidebar remains semantic equivalent of mobile tabs; no desktop-only route or clipped text |
| 1280, 1440, 1728 | Persistent sidebar; max 1320px content canvas and generous editorial whitespace | Open composition; no card wall; dominant action remains dominant | Centered dialog; contained media; sticky navigation leaves final interaction reachable; long text wraps before truncation |

Landscape uses the same width class while preserving keyboard/safe-area clearance. Content width, padding and column count may contract before meaning or controls are truncated.
