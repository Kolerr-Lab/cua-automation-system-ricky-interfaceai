/**
 * Deterministic fixtures for the mock legacy bank (blueprint §4 D6). Same appFamily, two tenants
 * branded/configured differently to prove cross-tenant reuse (§11).
 */
export interface Member {
  id: string;
  name: string;
  savings: string; // rendered as displayed on the legacy screen
  checking: string;
  /** 99999 exists but the operator lacks entitlement — a legitimate business outcome, not a crash. */
  restricted?: boolean;
}

export const MEMBERS: Record<string, Member> = {
  "12345": { id: "12345", name: "Jordan Rivera", savings: "$4,210.55", checking: "$1,502.10" },
  "67890": { id: "67890", name: "Sam Okafor", savings: "$88.00", checking: "$0.00" },
  "99999": { id: "99999", name: "Restricted Account", savings: "$0.00", checking: "$0.00", restricted: true },
  // 00000 (and any unknown id) => "No such member".
};

export interface TenantBrand {
  tenantId: string;
  brandName: string;
  savingsLabel: string; // ACME: "Savings Balance"; Globus: "Savings Bal." — cosmetic drift
  bg: string;
}

export const TENANTS: Record<string, TenantBrand> = {
  acme: { tenantId: "acme", brandName: "ACME CoreBanking", savingsLabel: "Savings Balance", bg: "#eef3fb" },
  globus: { tenantId: "globus", brandName: "Globus Bank", savingsLabel: "Savings Bal.", bg: "#f3f7ee" },
};

export function tenant(id: string): TenantBrand {
  return TENANTS[id] ?? TENANTS["acme"]!;
}
