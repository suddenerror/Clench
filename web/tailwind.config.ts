import type { Config } from "tailwindcss";

// §9 спеки, дословно: направление «табло», палитра, гарнитура, радиусы.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: "#16181C",
        surface: "#1F2229",
        ink: "#E8E6E1",
        gold: "#D4AF6A",
        side: {
          blue: "#3B82F6",
          orange: "#F97316",
          purple: "#A855F7",
          teal: "#14B8A6",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter-tight)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};

export default config;
