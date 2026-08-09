# Documents & export UI

STEP_147 expands `/export-share` into a documents workspace:

- catalog of exportable documents
- ExportJob create + status
- signed download link
- ShareLink create/revoke
- messenger adapters

Runtime files live under `apps/api/.data/exports` (gitignored).
PDF uses embedded Noto Sans (OFL) — see `assets/fonts/LICENSE-NotoSans.txt`.
