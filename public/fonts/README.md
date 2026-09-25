# Local fonts

The root layout loads the fonts with `next/font/local`. Production builds must
not require requests to Google Fonts to generate their stylesheets or assets.

Normal variable fonts downloaded from the Google Fonts repository on 2026-09-25:

- Cormorant Garamond (weight 300–700):
  https://github.com/google/fonts/tree/main/ofl/cormorantgaramond
- Bodoni Moda (weight 400–900, optical size axis retained):
  https://github.com/google/fonts/tree/main/ofl/bodonimoda

The original font binaries are unchanged; filenames were simplified. Each family
directory includes its SIL Open Font License in `OFL.txt`. Existing Satoshi and
Noto Sans assets are unaffected.
