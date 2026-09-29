/**
 * The example inquiries offered as buttons in the web app and run by the demo model's tests. No imports, so the
 * browser bundle can use this module without pulling in the rest of core.
 */
export interface ExampleInquiry {
  id: "fact" | "viewing" | "out-of-scope" | "german";
  label: string;
  inquiry: string;
}

export const EXAMPLE_INQUIRIES: readonly ExampleInquiry[] = [
  { id: "fact", label: "A fact question", inquiry: "Is heating included in the rent for HH-1001?" },
  {
    id: "viewing",
    label: "A viewing request",
    inquiry: "I'd like to view HH-1001 on Saturday morning. My email is jana.becker@example.com.",
  },
  { id: "out-of-scope", label: "Out of scope", inquiry: "Is the flat HH-1001 close to a gym?" },
  {
    id: "german",
    label: "Auf Deutsch",
    inquiry:
      "Ich habe einen kleinen Hund und suche eine Wohnung in Hamburg unter 2.000 €. Ist die Heizung inklusive, und kann ich Samstag besichtigen?",
  },
];
