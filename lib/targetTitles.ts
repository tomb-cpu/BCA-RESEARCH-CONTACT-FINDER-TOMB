// BCA target job titles. Apollo matches these against real job titles
// (substring/keyword match), so thematic entries like "Fixed Income" or
// "Geo-Macro" will match titles such as "Head of Fixed Income".
// Edit this list to tune who shows up in results.
export const TARGET_TITLES = [
  "Portfolio Manager",
  "Investment Manager",
  "Investment Strategist",
  "Investment Director",
  "Head of Investments",
  "Head of Equity Allocation",
  "Senior Portfolio Manager",
  "Family Office Investments",
  "Fixed Income",
  "Geo-Macro",
  "Portfolio Allocation",
  "Discretionary Portfolio Manager",
  "Chief Investment Officer",
  "CIO",
] as const;

export const TARGET_FIRM_TYPES = [
  "Asset Manager",
  "Hedge Fund",
  "Private Equity",
  "Family Office",
] as const;

export const MAX_CONTACTS = 20;
