export function clientDisplayName(company: string) {
  return company === "Drummond Heating" ? "Drummond's" : company;
}

export function hasDrummondsBrand(company: string) {
  return company === "Drummond Heating";
}
