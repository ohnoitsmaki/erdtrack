import { createCn } from "cn/config"

// Knows the theme's own text sizes (text-body, text-meta in theme.css) are
// sizes, not colours, so a text colour beside one doesn't drop it.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["body", "meta"] }] } },
})
