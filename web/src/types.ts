import type { Access } from '../../shared/plans';
export interface User {
  id: string;
  username: string;
  name: string;
  balance: number;
  createdAt?: string;
  email?: string | null;
  access?: Access;
  isAdmin?: boolean;
  hasPassword?: boolean;
  emailVerified?: boolean;
  needsUsername?: boolean;
}
export interface Named {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  kind?: string;
  limit?: number | null;
  closingDay?: number | null;
  dueDay?: number | null;
}
export interface Catalog {
  categories: Named[];
  paymentMethods: Named[];
  cards: Named[];
  incomeTypes: Named[];
}
export type TxType = 'income' | 'expense';
export type Kind = 'avista' | 'fixo' | 'parcelado';
export interface Transaction {
  id: string;
  type: TxType;
  kind: Kind;
  value: number;
  description: string;
  date: string;
  applied: boolean;
  categoryId: string | null;
  incomeTypeId: string | null;
  paymentMethodId: string | null;
  cardId: string | null;
  recurrenceId: string | null;
  planId: string | null;
  installmentNumber: number | null;
  category?: Named | null;
  incomeType?: Named | null;
  paymentMethod?: Named | null;
  card?: Named | null;
  plan?: { id?: string; installments: number; description?: string } | null;
  recurrence?: { id: string } | null;
}
export interface Saved {
  warnings?: string[];
}
export interface Box extends Named {
  amount: number;
  goal: number | null;
  goalAlertDismissed: boolean;
  createdAt: string;
  movements: { id: string; type: string; value: number; createdAt: string }[];
}
export interface Recurrence {
  id: string;
  type: TxType;
  value: number;
  description: string;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  categoryId: string | null;
  incomeTypeId: string | null;
  paymentMethodId: string | null;
  cardId: string | null;
  category?: Named | null;
  incomeType?: Named | null;
  paymentMethod?: Named | null;
  card?: Named | null;
}
export interface Plan {
  id: string;
  description: string;
  totalValue: number;
  installments: number;
  firstDate: string;
  categoryId: string | null;
  paymentMethodId: string | null;
  cardId: string | null;
  transactions: Transaction[];
}
export interface CardSummary extends Named {
  used: number;
  invoice: number;
  available: number | null;
  percent: number | null;
  from: string;
  to: string;
  dueDate: string | null;
}
export interface Dashboard {
  user: User;
  income: number;
  expense: number;
  toPay: number;
  saved: number;
  boxes: Box[];
  alerts: Box[];
  recent: Transaction[];
}
export interface ActivePlan {
  id: string;
  description: string;
  installments: number;
  totalValue: number;
  paid: number;
  remaining: number;
  installmentValue: number;
  last: string;
  category?: Named | null;
  card?: Named | null;
}
export interface Upcoming {
  id: string;
  type: TxType;
  kind: Kind;
  value: number;
  description: string;
  date: string;
  installmentNumber: number | null;
  installments: number | null;
  card: string | null;
}
export interface FinancePage {
  today: string;
  balance: number;
  incomeMonth: number;
  expenseMonth: number;
  toReceive: number;
  toPay: number;
  projectedBalance: number;
  tips: { level: 'alerta' | 'info' | 'ok'; text: string }[];
  cards: CardSummary[];
  projection: {
    month: string;
    income: number;
    expense: number;
    installments: number;
    fixed: number;
    balance: number;
  }[];
  fixedExpenses: Recurrence[];
  fixedIncomes: Recurrence[];
  fixedExpenseTotal: number;
  fixedIncomeTotal: number;
  commitment: number | null;
  activePlans: ActivePlan[];
  settledPlans: ActivePlan[];
  remainingInstallments: number;
  upcoming: Upcoming[];
}
export interface Group {
  name: string;
  icon: string;
  color: string;
  value: number;
  count: number;
  percent: number;
}
export interface Report {
  income: number;
  expense: number;
  net: number;
  fixed: number;
  installments: number;
  forecastExpense: number;
  byCategory: Group[];
  byKind: Group[];
  byPaymentMethod: Group[];
  byCard: Group[];
  byIncomeType: Group[];
  evolution: { month: string; income: number; expense: number }[];
  fixedExpenses: Recurrence[];
  fixedMonthly: number;
}
