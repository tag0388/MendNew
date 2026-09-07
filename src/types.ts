export type ForecastMethod = 'commitment' | 'time-based';
export type DistributionMethod = 'manual' | 'even' | 'front' | 'back' | 'bell';

export type ProjectStatus = 'Active' | 'On Hold' | 'Closed' | 'Archived';

export interface ProjectAttributeValue {
  id: string;
  description: string;
  sortOrder: number;
}

export interface ProjectAttribute {
  id: string; // "01" to "10"
  title: string;
  values: ProjectAttributeValue[];
}

export interface ResourceRate {
  id: string;
  name: string;
  unit: string;
  rate?: number;
  category?: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
}

export interface CostElement {
  id: string;
  description: string;
  sortCode: string;
}

export interface Enterprise {
  id: string;
  enterpriseId: string;
  name: string;
  logoURL?: string;
  adminUsers: string[];
  createdAt: string;
  theme?: 'light' | 'dark';
  users?: Record<string, { 
    email: string; 
    name?: string;
    displayName?: string;
    photoURL?: string;
    joinedDate?: string;
    joinedAt?: string;
    role: 'Enterprise System Admin' | 'Enterprise User' 
  }>;
  projectAttributes?: ProjectAttribute[];
  lineItemAttributes?: ProjectAttribute[];
  costCodeAttributes?: ProjectAttribute[];
  subcontractAttributes?: ProjectAttribute[];
  changeAttributes?: ProjectAttribute[];
  riskAttributes?: ProjectAttribute[];
  procurementAttributes?: ProjectAttribute[];
  progressAttributes?: ProjectAttribute[];
  changeTypes?: string[];
  riskTypes?: string[];
  resourceRates?: ResourceRate[];
  costElements?: CostElement[];
  categories?: string[];
  controlAccounts?: string[];
  orderNumbers?: string[];
  vendors?: Vendor[];
}

export interface Vendor {
  id: string;
  name: string;
  code?: string;
  contactEmail?: string;
  contactName?: string;
}

export interface Subcontract {
  id: string;
  projectId: string;
  enterpriseId: string;
  orderId: string; // Max 50
  orderName: string;
  orderScope: string;
  status: 'Active' | 'Complete' | 'On Hold';
  defaultCostCodeId?: string;
  defaultPhasingSource?: 'Manual' | 'Auto';
  defaultStartDate?: string;
  defaultEndDate?: string;
  defaultDistribution?: 'Even' | 'Bell Curve' | 'Front load' | 'Back load' | 'S-Curve' | 'Profile';
  paymentType: 'LumpSum' | 'Schedule of Rates' | 'Re-measurable';
  awardDate: string;
  vendorId: string;
  vendorName: string;
  vendorUsers: string[]; // Emails
  totalAmount: number;
  forecastChanges?: number;
  lineItems: SubcontractLineItem[];
  enterpriseSubcontractAttributes?: Record<string, string>;
  projectAttributes?: Record<string, string>;
  attributes?: Record<string, any>; // Keep for backward compatibility
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface SubcontractLineItem {
  id: string;
  subcontractId: string;
  projectId: string;
  itemNo: string;
  description: string;
  activityId?: string;
  costCodeId?: string;
  date?: string;
  qty: number;
  unit: string;
  rate: number;
  total: number;
  type: 'Original' | 'ChangeOrder';
  status: 'Approved' | 'Pending' | 'Forecast' | 'Rejected';
  startDate?: string;
  endDate?: string;
  phasingSource?: 'Manual' | 'Auto';
  distribution?: 'Even' | 'Bell Curve' | 'Front load' | 'Back load' | 'S-Curve' | 'Profile';
  periodValues?: Record<string, number>;
  enterpriseAttributes: Record<string, string>;
  projectAttributes: Record<string, string>;
  userDefined?: Record<string, any>;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subcontractId: string;
  projectId: string;
  enterpriseId: string;
  invoiceId: string;
  description: string;
  submittedDate?: string;
  certifiedDate?: string;
  paymentDate?: string;
  status: 'Draft' | 'Submitted' | 'Certified' | 'Rejected' | 'Paid';
  initiator?: string;
  vendorId: string;
  vendorName: string;
  totalAmount: number;
  certifiedAmount: number;
  items: InvoiceItem[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface InvoiceItem {
  id: string;
  subcontractLineItemId: string;
  itemNo: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  total: number;
  type?: 'Original' | 'ChangeOrder';
  claimQty: number;
  claimPercent: number;
  claimValue: number;
  periodicClaimQty?: number;
  periodicClaimPercent?: number;
  periodicClaimValue?: number;
  certifiedQty: number;
  certifiedPercent: number;
  certifiedValue: number;
  periodicCertifiedQty?: number;
  periodicCertifiedPercent?: number;
  periodicCertifiedValue?: number;
  commentary?: string;
}

export interface Risk {
  id: string; // Firestore Doc ID
  projectId: string;
  riskId: string; // User-facing UNIQUE ID (max 20 chars)
  description: string;
  type: string; // From Enterprise Admin
  status: 'Open' | 'Mitigated' | 'Closed' | 'Realized';
  strategy: 'Avoid' | 'Mitigate' | 'Transfer' | 'Accept';
  initiator: string; // max 50 char
  reference: string; // max 50 char
  exposure: number; // Formula sum of children (Beta Pert Exposure)
  minImpactTotal?: number;
  mostLikelyImpactTotal?: number;
  maxImpactTotal?: number;
  mitigation: number; // Legacy, kept for compatibility
  residualExposure: number; // Legacy, kept for compatibility
  periodId?: string;
  enterpriseAttributes?: Record<string, string>;
  projectAttributes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface RiskRecord {
  id: string;
  riskId: string; // Parent Risk Doc ID
  projectId: string;
  costCodeId: string; // From Project Cost Codes
  scope: string; // max 100 char
  enterpriseAttributes: Record<string, string>;
  projectAttributes: Record<string, string>;
  probability: number; // 0-1 (e.g. 0.4 for 40%)
  minImpactAmount: number; // $ Min Impact
  mostLikelyImpactAmount: number; // $ Most Likely Impact
  maxImpactAmount: number; // $ Max Impact
  betaPertImpactAmount: number; // $ (Min + 4*ML + Max) / 6
  createdAt: string;
  updatedAt: string;
}

export interface ProcurementStepDefinition {
  id: string;
  projectId?: string;
  enterpriseId?: string;
  name: string;
  order: number;
  isEnterpriseStandard?: boolean;
  defaultDurationDays?: number;
  enterpriseStepId?: string;
}

export interface ProcurementStepData {
  plannedDate?: string;
  actualDate?: string;
  forecastDate?: string;
  planDuration?: number;
  forecastDuration?: number;
}

export interface ProcurementItem {
  id: string;
  projectId: string;
  packageId: string;
  description: string;
  calendarId?: string;
  category?: string;
  enterpriseAttributes?: Record<string, string>;
  projectAttributes?: Record<string, string>;
  stepData: Record<string, ProcurementStepData>; // Keyed by step definition ID
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCostElement {
  id: string;
  description: string;
  sortCode: string;
  enterpriseCostElementId?: string;
}

export interface Project {
  id: string;
  enterpriseId: string;
  projectName: string;
  projectCode: string;
  status?: ProjectStatus;
  projectBudget: number;
  startDate: string;
  endDate: string;
  cutoffDate: string;
  users: Record<string, 'Project Admin' | 'Project User'>;
  attributes?: Record<string, string>;
  photoURL?: string;
  scopeDescription?: string;
  clientName?: string;
  projectManagerName?: string;
  dateCreated: string;
  dateLastModified: string;
  createdBy?: string;
  createdByEmail?: string;
  modifiedBy?: string;
  modifiedByEmail?: string;
  categories?: string[];
  controlAccounts?: string[];
  orderNumbers?: string[];
  costElements?: ProjectCostElement[];
  costCodeAttributes?: ProjectAttribute[];
  subcontractAttributes?: ProjectAttribute[];
  changeAttributes?: ProjectAttribute[];
  riskAttributes?: ProjectAttribute[];
  procurementAttributes?: ProjectAttribute[];
  progressAttributes?: ProjectAttribute[];
  procurementDefaults?: {
    calendarId?: string;
    stepDurations?: Record<string, number>; // stepId -> duration
    attributeValues?: Record<string, string>; // attrId -> valueId
  };
  changeTypes?: string[];
  riskTypes?: string[];
  lineItemAttributes?: ProjectAttribute[];
  resourceRates?: ResourceRate[];
  reportingPeriods?: {
    baseDate: string;
    duration: 'week' | 'month';
    numberOfPeriods: number;
    periods: { id: string; startDate: string; endDate: string; name: string; status: 'open' | 'closed' }[];
    currentPeriodId?: string;
  };
  progressPeriods?: {
    baseDate: string;
    duration: 'week';
    numberOfPeriods: number;
    periods: { id: string; startDate: string; endDate: string; name: string; status: 'open' | 'closed' }[];
    currentPeriodId?: string;
  };
  firstCostReportingMonth?: string;
  currentReportingMonth?: string;
  lastReportingMonth?: string;
}

export interface Sheet {
  id: string;
  projectId: string;
  sheetName: string;
  forecastMethod: ForecastMethod;
  version: string;
  lockedStatus: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  users?: string[]; // UIDs
}

export interface ForecastRow {
  id: string;
  sheetId: string;
  costCode: string;
  description: string;
  vendor: string;
  qty?: number;
  rate?: number;
  budget: number;
  committedCost: number;
  actualCostToDate: number;
  costToGo: number;
  eac: number;
  startDate?: string;
  endDate?: string;
  timePhasing: Record<string, number>;
  distributionMethod: DistributionMethod;
  enterpriseCostCodeAttributes?: Record<string, string>;
  enterpriseLineItemAttributes?: Record<string, string>;
  enterpriseSubcontractAttributes?: Record<string, string>;
  enterpriseChangeAttributes?: Record<string, string>;
  projectAttributes?: Record<string, string>;
  attributes?: Record<string, any>; // Keep for backward compatibility if needed
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
}

export interface CostCode {
  id: string; // Firestore Document ID
  code: string; // User-facing Cost Code ID
  projectId: string;
  name: string;
  enterpriseAttributes: Record<string, string>;
  projectAttributes: Record<string, string>;
  eacMethod: 'Manual' | 'Change Management' | 'ETC Details' | 'Sub-Contract Management';
  sortOrder: number;
  activityId?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;

  // Budget Fields
  baselineBudget: number;
  budgetChanges: number;
  approvedBudget: number;
  approvedBudgetPrevious: number;
  approvedBudgetMovement: number;

  // Actual Cost Fields
  actualCostThisPeriod: number;
  actualCostToDate: number;

  // EAC & ETC Fields
  estimateToComplete: number;
  estimateAtCompletion: number;
  estimateAtCompletionPrevious: number;
  estimateAtCompletionMovement: number;

  // Variance Fields
  costVariance: number;
  costVariancePrevious: number;
  costVarianceMovement: number;

  // Access Control
  assignedUsers?: string[]; // Array of user UIDs
}

export interface SavedView {
  id: string;
  name: string;
  tableId: string;
  columns: string[];
  gridState?: any; // For AG-Grid state
  userId: string;
  createdAt: string;
}

export interface EtcDetail {
  id: string;
  projectId: string;
  costCode: string;
  calendarId?: string;
  category?: string;
  item: string;
  description: string;
  orderNumber: string;
  udf1: string;
  udf2: string;
  udf3: string;
  udf4: string;
  qty: number;
  unit: string;
  rate: number;
  phasingMethod: 'Manual' | 'Auto-Phase';
  phasingStartDate: string;
  phasingEndDate: string;
  activityId?: string;
  phasingUnit: 'Daily' | 'Weekly' | 'Monthly' | 'Total' | 'Profile';
  phasingQty: number;
  enterpriseAttributes?: Record<string, string>;
  projectAttributes?: Record<string, string>;
  periodValues: Record<string, number>;
  sortOrder: number;
  createdAt: string;
  updatedAt?: string;
  isEnterpriseResource?: boolean;
  resourceId?: string;
  totalEtcPrevious?: number;
}

export interface Calendar {
  id: string;
  projectId?: string;
  enterpriseId?: string;
  name: string;
  weekends: number[];
  holidays: string[];
  createdAt: string;
}

export interface Change {
  id: string; // Firestore Doc ID
  projectId: string;
  changeId: string; // User-facing UNIQUE ID (max 20 chars)
  description: string;
  type: string; // From Enterprise Admin
  status: 'Approved' | 'Pending' | 'Rejected' | 'Withdrawn';
  initiator: string; // max 50 char
  reference: string; // max 50 char
  budget: number; // Formula sum of children
  eac: number; // Formula sum of children
  periodId?: string;
  enterpriseAttributes?: Record<string, string>;
  projectAttributes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRecord {
  id: string;
  changeId: string; // Parent Change Doc ID
  projectId: string;
  costCodeId: string; // From Project Cost Codes
  scope: string; // max 100 char
  enterpriseAttributes: Record<string, string>;
  projectAttributes: Record<string, string>;
  budgetAmount: number;
  eacAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressPackage {
  id: string;
  projectId: string;
  packageId: string; // Unique per project (max 20 char)
  description: string;
  ruleOfCreditId?: string;
  unit?: string;
  attributes?: Record<string, string>; // Map of attrId to valueId
  defaultStartDate?: string;
  defaultEndDate?: string;
  defaultPhasingMethod?: 'Auto' | 'Manual';
  defaultPhasingCurve?: 'Scurve' | 'Bell' | 'front load' | 'back load' | 'even';
  createdAt: string;
  updatedAt: string;
}

export interface ProgressItem {
  id: string;
  projectId: string;
  packageId: string; // The user-facing ID of the package
  packageDocId: string; // The Firestore ID of the package
  itemId: string; // Unique per package
  activityId?: string;
  description: string;
  costCodeId: string;
  totalQty: number;
  totalQtyPrevious?: number;
  earnedQtyPrevious?: number;
  plannedStartDate: string;
  plannedEndDate: string;
  phasingMethod: 'Auto' | 'Manual';
  phasingCurve: 'Scurve' | 'Bell' | 'front load' | 'back load' | 'even';
  projectAttributes?: Record<string, string>;
  enterpriseAttributes?: Record<string, string>;
  ruleOfCreditId?: string;
  ruleOfCreditProgress?: Record<string, number>; // stepId -> progress percentage (0-100)
  periodValues?: Record<string, number>; // periodId -> qty
  currentStartDate?: string;
  currentEndDate?: string;
  currentPhasingMethod?: 'Auto' | 'Manual';
  currentPhasingCurve?: 'Scurve' | 'Bell' | 'front load' | 'back load' | 'even';
  currentPeriodValues?: Record<string, number>;
  actualPeriodValues?: Record<string, number>;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressReportingPeriod {
  id: string;
  projectId: string;
  periodName: string;
  startDate: string;
  endDate: string;
  status: 'Open' | 'Closed';
  createdAt: string;
}

export interface ProgressAttribute {
  id: string;
  projectId: string;
  title: string;
  type: 'text' | 'dropdown' | 'date' | 'number';
  values?: { id: string; description: string }[];
}

export interface RuleOfCredit {
  id: string;
  projectId: string;
  ruleId: string; // Max 20 chars
  description: string;
  packageId?: string;
  userField1?: string;
  userField2?: string;
  userField3?: string;
  userField4?: string;
  userField5?: string;
  steps?: RuleOfCreditStep[];
  createdAt: string;
}

export interface RuleOfCreditStep {
  id: string;
  orderNo: number; // decimal, max 10
  description: string; // max 100
  weight: number; // decimal
}

export interface ScheduleItem {
  id: string;
  projectId: string;
  activityId: string;
  description: string;
  activityPercentComplete: number;
  baselineStartDate: string;
  baselineEndDate: string;
  plannedStartDate: string;
  plannedEndDate: string;
  currentStartDate: string;
  currentEndDate: string;
  updatedAt: string;
}
