import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--site-bg)",
        panel: "var(--site-surface)",
        muted: "var(--site-bg2)",
        line: "var(--site-border)",
        mist: "var(--site-t1)",
        faint: "var(--site-t2)",
        bone: "var(--site-t0)",
        primary: "var(--site-green)",
        teal: "var(--site-teal)",
        on: "#06150d",
        accent: "var(--site-red)",
        warn: "var(--site-gold)",
        emerald: "var(--site-green)",
        amber: "var(--site-gold)",
        crimson: "var(--site-red)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Space Grotesk", "var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        drawer: "0 20px 25px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
