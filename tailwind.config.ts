import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Inntris-system base
        "bg-primary": "#050A16",
        "surface-elevated": "#0E1626",
        "border-subtle": "#1F2937",
        "text-primary": "#FFFFFF",
        "text-secondary": "#94A3B8",
        // Inntris teal accent
        "accent-teal": "#00D4B8",
        // DTM Inc. practice accent — PLACEHOLDER until flatbed scan is sampled (§16).
        // Do NOT treat this as final. Designer must replace after colorimeter / 600dpi scan.
        "accent-dtm-green": "#2E7D32",
        // States
        "state-success": "#22C55E",
        "state-warning": "#F59E0B",
        "state-danger": "#EF4444",
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
