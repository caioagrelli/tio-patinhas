export interface User { id: string; username: string; name: string; balance: number }
export interface Named { id: string; name: string; icon?: string; color?: string; isDefault?: boolean; kind?: string; limit?: number | null; closingDay?: number | null; dueDay?: number | null }
export interface Catalog { categories: Named[]; paymentMethods: Named[]; cards: Named[]; incomeTypes: Named[] }
export interface Transaction {
  id: string; type: 'income' | 'expense'; kind: 'avista' | 'fixo' | 'parcelado'; value: number; description: string;
  date: string; applied: boolean; categoryId: string | null; incomeTypeId: string | null; paymentMethodId: string | null;
  cardId: string | null; category?: Named | null; installmentNumber: number | null; plan?: { installments: number } | null;
}
export interface Box extends Named { amount: number; goal: number | null; goalAlertDismissed: boolean; movements: { id: string; type: string; value: number; createdAt: string }[] }
export interface Recurrence {
  id: string; type: 'income' | 'expense'; value: number; description: string; dayOfMonth: number; startDate: string; endDate: string | null;
  active: boolean; categoryId: string | null; incomeTypeId: string | null; paymentMethodId: string | null; cardId: string | null;
}
export interface Plan { id: string; description: string; totalValue: number; installments: number; firstDate: string; transactions: Transaction[] }
export interface Dashboard {
  user: User; income: number; expense: number; saved: number; alerts: Box[]; recent: Transaction[]; upcoming: Transaction[];
  projection: { month: string; income: number; expense: number; net: number }[];
  cards: (Named & { invoice: number; used: number; available: number | null; from: string; to: string; dueDate: string | null })[];
}
export interface Report { income: number; expense: number; net: number; fixed: number; installments: number; byCategory: { name: string; color: string; value: number }[] }
