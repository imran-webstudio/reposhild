import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#090A0F",
        panel: "#11131C",
        line: "#1E2230",
        mist: "#8B93A7",
        bone: "#E7E9F2",
        emerald: "#10B981",
        amber: "#F59E0B",
        crimson: "#EF4444",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        drawer: "-24px 0 80px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
