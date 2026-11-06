export const PAGE_PERMISSIONS = {
  orders: ["orders"],
  neworder: ["orders", "counter"],
  trips: ["trips"],
  departure: ["trips"],
  debt: ["debts"],
  counter: ["counter"],
  customers: ["customers"],
  products: ["stock", "catalog"],
  productedit: ["catalog"],
  stockhistory: ["stock", "reports"],
  watercontrol: ["waterControl", "reports"],
  waterreports: ["waterControl", "reports"],
  reports: ["reports"],
  expenses: ["expenses", "reports"],
  history: ["reports"],
  staff: ["staff"],
  corrections: ["correct"],
  display: ["display"],
  audit: ["reports"],
};
export function canAccessPage(user, page) {
  return (
    !!user &&
    (!!user?.owner ||
      !Object.hasOwn(PAGE_PERMISSIONS, page) ||
      PAGE_PERMISSIONS[page].some((key) => user?.permissions?.includes(key)))
  );
}
