import { readFileSync } from "node:fs";
export function phoneSavedResultsHostedProbe() {
  return readFileSync("scripts/verify/learn-phone-saved-results.assert.sql", "utf8").replace(
    "insert into tenants(id) values(pg_temp.saved_result_id(1)),(pg_temp.saved_result_id(2));",
    `insert into tenants(id,slug,display_name) values(pg_temp.saved_result_id(1),'saved-results-rollback-a','Synthetic rollback A'),(pg_temp.saved_result_id(2),'saved-results-rollback-b','Synthetic rollback B');
insert into auth.users(id,email,banned_until) values(pg_temp.saved_result_id(10),'saved-results-rollback-owner@example.invalid','infinity'),(pg_temp.saved_result_id(11),'saved-results-rollback-viewer@example.invalid','infinity');`,
  );
}
