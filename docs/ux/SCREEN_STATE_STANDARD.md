# UI screen state standard

Every screen defines loading, empty, error, forbidden, and success states.
States preserve the page heading, explain the next action, and never expose raw
errors, identifiers, or health payloads. Loading uses a stable skeleton; errors
offer retry or support; forbidden explains access without leaking policy.
