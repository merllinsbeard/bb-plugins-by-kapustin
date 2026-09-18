// Values shared by server.ts and app.tsx. Kept free of server-only imports so
// the frontend bundle never pulls in backend code.
export const GROUP_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const GROUP_NAME_MAX = 80;

/** Realtime channel app.tsx listens on. */
export const GROUPS_CHANGED = "groups-changed";
