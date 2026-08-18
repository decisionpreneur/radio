# UI, UX, Copy, And Design Sources

## Verbatim Prompt Sources

```text
on ui ux copywriting and design use tafti and all from gdrive lit and dbox lit
```

## Source Material Used

Google Drive Lit evidence:

- `tafti` exact search returned no matching source in the checked Google Drive and Dropbox material.
- `Tufte` search returned growth-plan documents that name Tufte, grid systems, newspaper design, Norman, Raskin, Tognazzini, and information style as the relevant design-reading cluster.
- `Interface Information` search returned the generated Lit index with local and Dropbox Lit UI/design categories.

Dropbox Lit local evidence:

```text
/Lit/Literature/Envisioning Information.pdf
/Lit/Literature/Grid Systems In Graphic Design.pdf
/Lit/Writing_and_design/Infostyle
/Lit/Writing_and_design/Infostyle/Editors_School_materials/Interface_and_Information
/Lit/Writing_and_design/Infostyle/Editors_School_materials/Interface_and_Information/03_12-16_Sep_Fitts_Law_Proximity_Theory
```

Read source titles from those folders: `Text Theory - Information Style`, `Informativeness. Rule of Seven Elements`, and `Fitts Law. Proximity Theory`.

## Applied UI Rules

Signal over noise:

- Keep the timeline and voice facts as the dominant view.
- Remove repeated explanatory text from the product screen.
- Keep controls as labels, inputs, and direct actions.

Information style:

- Use concrete payment words.
- Use `payment email`, not `checkout email`, in the visible interface.
- Convert machine error codes into short user-facing status text.

Design and information-style cluster:

- Prefer direct evidence surfaces over decorative explanation.
- Keep visual structure grid-based.
- Keep comparisons visible in the voice list instead of forcing memory.

Fitts/proximity:

- Use larger click targets for top actions.
- Keep transport actions together.
- Keep commerce actions together.
- Keep unlock and clear actions inside the paywall group.

Rule-of-seven correction:

- Do not hide useful controls merely to keep the count low.
- The screen may show more than seven controls when the controls are visible and labeled.

## Implemented Changes

- `web/index.html`: grouped transport and commerce actions, changed checkout link copy to `Subscribe`, changed visible email label to `Payment email`.
- `web/styles.css`: larger click targets and grouped action spacing.
- `web/lib/paywall.mjs`: source-backed status-copy mapping for license and payment-email errors.
- `web/app.mjs`: uses the status-copy mapping instead of exposing raw error codes.
