module.exports = {
  purge: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: false,
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#7c5cff",
          hover: "#6b46f0",
        },
        "accent-2": "#d946ef",
        surface: "#131319",
        border: "#242430",
        titlebar: "#0a0a10",
        "button-hover": "#1f1f2b",
        background: "#08080c",
        muted: "#9999ab",
        warning: "#f59e0b",
        danger: "#ef4444",
        success: "#10b981",
      },
      fontFamily: {
        sans: [
          "Segoe UI",
          "Inter",
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
      },
      fontSize: {
        11: "11px",
        15: "15px",
      },
      transitionProperty: {
        width: "width",
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
      // `brightness` (a filter utility) only ships with the `responsive` variant by
      // default in v2; `hover:brightness-*` needs it added explicitly.
      brightness: ["hover"],
    },
  },
  plugins: [],
}
