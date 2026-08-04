module.exports = {
  purge: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: false,
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#a855f7",
          hover: "#9333ea",
        },
        surface: "#151019",
        titlebar: "#0b0810",
        "button-hover": "#261b33",
        background: "#050308",
        muted: "#e3e1e8",
        warning: "#e5a54b",
        danger: "#e5484d",
        success: "#22c55e",
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
    },
  },
  plugins: [],
}
