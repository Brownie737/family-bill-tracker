import { useEffect, useMemo, useState } from "react";
import AddBillForm from "./AddBillForm";
import { normalizeBillCategory } from "../lib/firestore";
import type { BillCategory, BillListItem, BillStatus } from "../lib/firestore";

export type BillDetailsSaveInput =
  | {
      kind: "one-time";
      name: string;
      amount: number;
      dueDate: string;
      status: BillStatus;
      category: BillCategory;
      autopay: boolean;
      accountLast4: string | null;
    }
  | {
      kind: "monthly";
      name: string;
      amount: number;
      recurrence: "monthly";
      dayOfMonth: number;
      category: BillCategory;
      autopay: boolean;
      accountLast4: string | null;
    };

type BillDetailsModalProps = {
  open: boolean;
  bill: BillListItem | null;
  mode: "view" | "edit";
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (payload: BillDetailsSaveInput) => Promise<void> | void;
};

function parseYYYYMMDD(dueDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return null;
  }

  const [year, month, day] = dueDate.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getCurrentYYYYMM(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getRecurringDueDateInCurrentMonth(dayOfMonth: number | null | undefined, date = new Date()) {
  if (typeof dayOfMonth !== "number" || !Number.isInteger(dayOfMonth)) {
    return null;
  }

  const month = date.getMonth();
  const year = date.getFullYear();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(Math.max(dayOfMonth, 1), lastDay);
  return new Date(year, month, clampedDay);
}

function getViewStatus(bill: BillListItem): "paid" | "unpaid" | "overdue" {
  const now = new Date();
  const todayStart = startOfDay(now);
  const currentYYYYMM = getCurrentYYYYMM(now);

  if (bill.recurrence === "monthly") {
    if (bill.paidForMonth === currentYYYYMM) {
      return "paid";
    }

    const dueDate = getRecurringDueDateInCurrentMonth(bill.dayOfMonth, now);
    if (!dueDate) {
      return "unpaid";
    }

    return startOfDay(dueDate).getTime() < todayStart.getTime() ? "overdue" : "unpaid";
  }

  if (bill.status === "paid") {
    return "paid";
  }

  if (!bill.dueDate) {
    return "unpaid";
  }

  const dueDate = parseYYYYMMDD(bill.dueDate);
  if (!dueDate) {
    return "unpaid";
  }

  return startOfDay(dueDate).getTime() < todayStart.getTime() ? "overdue" : "unpaid";
}

export default function BillDetailsModal({
  open,
  bill,
  mode,
  saving = false,
  error = null,
  onClose,
  onEdit,
  onCancelEdit,
  onSaved,
}: BillDetailsModalProps) {
  const [billName, setBillName] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billType, setBillType] = useState<"one-time" | "monthly">("one-time");
  const [billCategory, setBillCategory] = useState<BillCategory>("Subscriptions");
  const [billDueDate, setBillDueDate] = useState("");
  const [billDayOfMonth, setBillDayOfMonth] = useState("1");
  const [autopay, setAutopay] = useState(true);
  const [accountLast4, setAccountLast4] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!bill) {
      setBillName("");
      setBillAmount("");
      setBillType("one-time");
      setBillCategory("Subscriptions");
      setBillDueDate("");
      setBillDayOfMonth("1");
      setAutopay(true);
      setAccountLast4("");
      setLocalError(null);
      return;
    }

    setBillName(bill.name);
    setBillAmount(String(bill.amount));
    setBillType(bill.recurrence === "monthly" ? "monthly" : "one-time");
    setBillCategory(normalizeBillCategory(bill.category, "Other"));
    setBillDueDate(bill.dueDate ?? "");
    setBillDayOfMonth(String(bill.dayOfMonth ?? 1));
    setAutopay(bill.autopay === true);
    setAccountLast4(typeof bill.accountLast4 === "string" ? bill.accountLast4 : "");
    setLocalError(null);
  }, [bill, mode, open]);

  const detailsStatus = useMemo(() => (bill ? getViewStatus(bill) : "unpaid"), [bill]);

  if (!open || !bill) {
    return null;
  }

  const isRecurring = bill.recurrence === "monthly";
  const currentYYYYMM = getCurrentYYYYMM();
  const displayAccountLast4 =
    typeof bill.accountLast4 === "string" && /^\d{4}$/.test(bill.accountLast4) ? `••••${bill.accountLast4}` : "Not set";

  const statusLabel = detailsStatus === "paid" ? "Paid" : detailsStatus === "overdue" ? "Overdue" : "Unpaid";
  const statusClassName =
    detailsStatus === "paid" ? "sheetBadge sheetBadgePaid" : detailsStatus === "overdue" ? "sheetBadge sheetBadgeOverdue" : "sheetBadge sheetBadgeUnpaid";

  const handleEditSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    const name = billName.trim();
    const amount = Number(billAmount);
    const normalizedLast4 = accountLast4.replace(/\D/g, "");
    const normalizedLast4OrNull = normalizedLast4.length === 0 ? null : normalizedLast4;
    const category = normalizeBillCategory(billCategory, "Subscriptions");

    if (!name) {
      setLocalError("Bill name is required");
      return;
    }

    if (!Number.isFinite(amount)) {
      setLocalError("Amount must be a valid number");
      return;
    }

    if (normalizedLast4OrNull !== null && normalizedLast4OrNull.length !== 4) {
      setLocalError("Account Last 4 must be exactly 4 digits");
      return;
    }

    if (billType === "monthly") {
      const dayOfMonth = Number.parseInt(billDayOfMonth, 10);
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        setLocalError("Day of month must be between 1 and 31");
        return;
      }

      await onSaved({
        kind: "monthly",
        name,
        amount,
        recurrence: "monthly",
        dayOfMonth,
        category,
        autopay,
        accountLast4: normalizedLast4OrNull,
      });
      return;
    }

    await onSaved({
      kind: "one-time",
      name,
      amount,
      dueDate: billDueDate.trim(),
      status: bill.status,
      category,
      autopay,
      accountLast4: normalizedLast4OrNull,
    });
  };

  return (
    <>
      <button type="button" className="sheetBackdrop" aria-label="Close bill details" onClick={onClose} />
      <section className="centerModal" role="dialog" aria-modal="true" aria-label="Bill details">
        <div className="sheetHeader">
          <h3>{bill.name || "Bill Details"}</h3>
          <div className="billDetailsHeaderActions">
            {mode === "view" ? (
              <button type="button" className="billsMenuButton billDetailsEditBtn" onClick={onEdit}>
                Edit
              </button>
            ) : null}
            <button type="button" className="sheetToggleBtn" aria-label="Close bill details" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="centerModalBody">
          {mode === "view" ? (
            <div className="billDetailsGrid">
              <div className="billDetailsItem">
                <span className="billDetailsLabel">Name</span>
                <strong>{bill.name}</strong>
              </div>
              <div className="billDetailsItem">
                <span className="billDetailsLabel">Amount</span>
                <strong>
                  {bill.amount.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                  })}
                </strong>
              </div>
              <div className="billDetailsItem">
                <span className="billDetailsLabel">Category</span>
                <strong>{normalizeBillCategory(bill.category, "Other")}</strong>
              </div>
              <div className="billDetailsItem">
                <span className="billDetailsLabel">Status</span>
                <span className={statusClassName}>{statusLabel}</span>
              </div>
              <div className="billDetailsItem">
                <span className="billDetailsLabel">Schedule</span>
                <strong>{isRecurring ? `Monthly recurring • Day ${bill.dayOfMonth ?? "?"}` : `Due ${bill.dueDate ?? "Not set"}`}</strong>
              </div>
              <div className="billDetailsItem">
                <span className="billDetailsLabel">Autopay</span>
                <strong>{bill.autopay === true ? "Enabled" : "Disabled"}</strong>
              </div>
              <div className="billDetailsItem">
                <span className="billDetailsLabel">Account</span>
                <strong>{displayAccountLast4}</strong>
              </div>
              {isRecurring ? (
                <div className="billDetailsItem">
                  <span className="billDetailsLabel">Paid For Month</span>
                  <strong>
                    {bill.paidForMonth === currentYYYYMM
                      ? `${currentYYYYMM} (current month paid)`
                      : bill.paidForMonth
                        ? `${bill.paidForMonth} (historical)`
                        : `Not paid for ${currentYYYYMM}`}
                  </strong>
                </div>
              ) : null}
            </div>
          ) : (
            <AddBillForm
              mode="edit"
              billName={billName}
              billAmount={billAmount}
              billType={billType}
              billCategory={billCategory}
              billDueDate={billDueDate}
              billDayOfMonth={billDayOfMonth}
              autopay={autopay}
              accountLast4={accountLast4}
              billBusy={saving}
              billError={localError ?? error}
              onSubmit={handleEditSubmit}
              onBillNameChange={setBillName}
              onBillTypeChange={setBillType}
              onBillCategoryChange={setBillCategory}
              onBillAmountChange={setBillAmount}
              onBillDueDateChange={setBillDueDate}
              onBillDayOfMonthChange={setBillDayOfMonth}
              onAutopayChange={setAutopay}
              onAccountLast4Change={setAccountLast4}
              onCancel={onCancelEdit}
              submitLabel="Save"
              cancelLabel="Cancel"
            />
          )}
        </div>
      </section>
    </>
  );
}
