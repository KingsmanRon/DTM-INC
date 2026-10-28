/**
 * Branding, wording and contact for the interactive demo. Everything here is
 * the demo's own configuration: it is public, contains no secrets and is not
 * connected to any production system.
 */

export const BRAND = {
  product: {
    name: "DTM Inc.",
    demoTitle: "Interactive product demo",
  },

  sales: {
    /** Recipient for every "Request a personalised demo" link. */
    email: "ronald@inntris.com",
    subject: "Personalised demo request: DTM Inc.",
    /** Pre-filled enquiry body. Contains prompts only, never personal data. */
    body: [
      "Hello,",
      "",
      "I would like to request a personalised demonstration of DTM Inc.",
      "",
      "Name:",
      "Practice name:",
      "Practice type (general practice / specialist / several hospitals):",
      "Number of hospitals:",
      "Best contact number or email:",
      "Preferred days and times:",
      "",
      "Anything you would like us to cover in the demonstration:",
      "",
      "Thank you.",
    ].join("\n"),
  },

  legal: {
    footerLine: "DTM Inc. · Interactive product demo",
    dataLine: "Fictional demonstration data only. No patient information is used on this page.",
  },

  demo: {
    notice: "Interactive demonstration. All patient information is fictional.",
    /** Shown wherever the demo role selector appears. */
    roleSimulationNote:
      "Role switching is a simulation, not a live sign-in. Nothing here is authenticated.",
  },

  /** Label for the monthly billing batch capability. Change it here only. */
  features: {
    billingTracking: {
      label: "Billing File Tracking",
      scopeStatement:
        "Tracks which patient files are handed to your external billing company, and when. It does not submit medical aid claims, calculate tariffs, issue invoices or process payments.",
    },
  },
} as const;

export type Brand = typeof BRAND;
