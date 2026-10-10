/** Preview navigation must never take a tester into the live client workspace. */
export function publicHomeLoginHref(environment?: string) {
  return environment === "production"
    ? "https://app.openfolk.ai/login?redirect=%2Fclient"
    : "/login?redirect=%2Fclient";
}
