# Accessibility checklist

- Tab/Shift+Tab order follows the visual task order; Enter/Space activate controls and Escape closes a dismissible sheet/dialog.
- Visible focus is never hidden. Dialogs and sheets trap focus and return it to the trigger; closed or disabled content cannot receive focus.
- Every input has an accessible name, associated validation/error text and applicable autocomplete hint. Async loading, success and error changes use a non-disruptive status announcement.
- Semantic landmarks/headings and screen-reader names are present. Contrast and more than color communicate every state.
- Touch targets are at least 44px. 200% text, long Russian strings and landscape preserve task completion without horizontal page overflow.
- Reduced motion removes decorative motion while retaining status and controls. This is a production contract, not WCAG certification.
