module.exports = {
  purge: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: false,
  theme: {
    extend: {
      // Material Design 3 / Google Photos-inspired palette: Google blue as primary,
      // the standard red/yellow/green trio for status. Values are CSS variables (set in
      // styles.css, swapped by the `dark` class on <html>) rather than hex literals, so
      // one class toggle re-themes every utility below with no `dark:` variants needed.
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
        },
        "primary-container": "var(--color-primary-container)",
        "on-primary-container": "var(--color-on-primary-container)",
        surface: "var(--color-surface)",
        "surface-variant": "var(--color-surface-variant)",
        background: "var(--color-background)",
        border: "var(--color-border)",
        outline: "var(--color-outline)",
        titlebar: "var(--color-titlebar)",
        "button-hover": "var(--color-button-hover)",
        ink: "var(--color-ink)",
        muted: "var(--color-muted)",
        warning: "var(--color-warning)",
        "warning-container": "var(--color-warning-container)",
        danger: "var(--color-danger)",
        "danger-container": "var(--color-danger-container)",
        success: "var(--color-success)",
        "success-container": "var(--color-success-container)",
      },
      fontFamily: {
        sans: [
          "Google Sans",
          "Roboto",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      // Tailwind v2 has no bracket arbitrary-value syntax (that's a v3+ feature),
      // so exact pixel values the design needs are named here instead.
      spacing: {
        38: "38px",
        42: "42px",
        46: "46px",
        56: "56px",
        thumb: "220px",
      },
      maxWidth: {
        content: "640px",
      },
      borderRadius: {
        7: "7px",
        19: "19px",
        22: "22px",
        23: "23px",
        28: "28px",
      },
      fontSize: {
        11: "11px",
        15: "15px",
      },
      transitionProperty: {
        width: "width",
      },
      // Material elevation levels, using Google's own two-shadow (key + ambient) recipe.
      // --shadow-tint is an "r, g, b" triplet (not a full color) so it can be dropped
      // straight into rgba() here; it darkens further in the dark theme.
      boxShadow: {
        1: "0 1px 2px 0 rgba(var(--shadow-tint), 0.30), 0 1px 3px 1px rgba(var(--shadow-tint), 0.15)",
        2: "0 1px 2px 0 rgba(var(--shadow-tint), 0.30), 0 2px 6px 2px rgba(var(--shadow-tint), 0.15)",
        3: "0 1px 3px 0 rgba(var(--shadow-tint), 0.30), 0 4px 8px 3px rgba(var(--shadow-tint), 0.15)",
      },
    },
  },
  variants: {
    // Tailwind v2 doesn't enable the `disabled:` variant by default for these
    // utilities (that only became default in v3), so it must be opted into explicitly.
    extend: {
      backgroundColor: ["disabled"],
      textColor: ["disabled"],
      cursor: ["disabled"],
      opacity: ["disabled"],
      textDecoration: ["disabled"],
      backgroundOpacity: ["disabled"],
      textOpacity: ["disabled"],
      boxShadow: ["disabled"],
    },
  },
  plugins: [],
}
