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
] as const;

// Titles to reject even if they slip past the positive match above (e.g. via
// Apollo's similar-title expansion or an unfiltered ContactOut result).
// Matched as case-insensitive substrings against the person's title.
export const EXCLUDED_TITLE_KEYWORDS = [
  "assistant",
  "intern",
  "trainee",
  "apprentice",
  "student",
  "data analyst",
  "data analytics",
  "data scientist",
  "information officer",
  "information technology",
  "software",
  "developer",
  "recruit",
  "receptionist",
] as const;

export const TARGET_FIRM_TYPES = [
  "Asset Manager",
  "Hedge Fund",
  "Private Equity",
  "Family Office",
] as const;

export const MAX_CONTACTS = 50;
