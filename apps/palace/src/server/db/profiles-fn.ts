import { createServerFn } from "@tanstack/react-start";
import { listProfiles } from "./queries/profiles";

export const getProfiles = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await listProfiles();
  return { profiles: rows, timestamp: new Date().toISOString() };
});
