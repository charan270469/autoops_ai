/** Maps each workflow step id to the mock agent that handles it. */
export const ASSIGNED_AGENT_BY_STEP = {
  HR_COLLECT_DATA: "agent-hr-onboarding",
  IT_CREATE_EMAIL: "agent-it-identity",
  IT_SETUP_SYSTEMS: "agent-it-provisioning",
  FINANCE_SETUP_PAYROLL: "agent-finance-payroll",
  COMPLIANCE_VERIFY_DOCS: "agent-compliance-kyc",
  MANAGER_ASSIGN_TASKS: "agent-manager-coach",
};

export const STEP_IDS = [
  "HR_COLLECT_DATA",
  "IT_CREATE_EMAIL",
  "IT_SETUP_SYSTEMS",
  "FINANCE_SETUP_PAYROLL",
  "COMPLIANCE_VERIFY_DOCS",
  "MANAGER_ASSIGN_TASKS",
];

export function getAssignedAgent(stepId) {
  return ASSIGNED_AGENT_BY_STEP[stepId] ?? "agent-unknown";
}
