import type { FormEvent } from "react";
import { BILL_CATEGORIES } from "../lib/firestore";
import type { BillCategory } from "../lib/firestore";

type AddBillFormProps = {
  billName: string;
  billAmount: string;
  billType: "one-time" | "monthly";
  billCategory: BillCategory;
  billDueDate: string;
  billDayOfMonth: string;
  autopay: boolean;
  accountLast4: string;
  billBusy: boolean;
  billError: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBillNameChange: (value: string) => void;
  onBillTypeChange: (value: "one-time" | "monthly") => void;
  onBillCategoryChange: (value: BillCategory) => void;
  onBillAmountChange: (value: string) => void;
  onBillDueDateChange: (value: string) => void;
  onBillDayOfMonthChange: (value: string) => void;
  onAutopayChange: (value: boolean) => void;
  onAccountLast4Change: (value: string) => void;
};

export default function AddBillForm({
  billName,
  billAmount,
  billType,
  billCategory,
  billDueDate,
  billDayOfMonth,
  autopay,
  accountLast4,
  billBusy,
  billError,
  onSubmit,
  onBillNameChange,
  onBillTypeChange,
  onBillCategoryChange,
  onBillAmountChange,
  onBillDueDateChange,
  onBillDayOfMonthChange,
  onAutopayChange,
  onAccountLast4Change,
}: AddBillFormProps) {
  return (
    <form onSubmit={onSubmit} className="addBillForm">
      <label className="billFormFieldLabel">
        Name
        <input
          value={billName}
          onChange={(event) => onBillNameChange(event.target.value)}
          required
          className="billFormInput"
        />
      </label>

      <label className="billFormFieldLabel">
        Bill Type
        <select
          value={billType}
          onChange={(event) => onBillTypeChange(event.target.value as "one-time" | "monthly")}
          className="billFormInput"
        >
          <option value="one-time">One-Time</option>
          <option value="monthly">Monthly Recurring</option>
        </select>
      </label>

      <label className="billFormFieldLabel">
        Category
        <select
          value={billCategory}
          onChange={(event) => onBillCategoryChange(event.target.value as BillCategory)}
          className="billFormInput"
        >
          {BILL_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>

      <label className="billFormFieldLabel">
        Amount
        <input
          value={billAmount}
          onChange={(event) => onBillAmountChange(event.target.value)}
          type="number"
          step="0.01"
          required
          className="billFormInput"
        />
      </label>

      {billType === "one-time" ? (
        <label className="billFormFieldLabel">
          Due Date (optional)
          <input
            value={billDueDate}
            onChange={(event) => onBillDueDateChange(event.target.value)}
            type="date"
            className="billFormInput"
          />
        </label>
      ) : (
        <label className="billFormFieldLabel">
          Due Day of Month
          <select
            value={billDayOfMonth}
            onChange={(event) => onBillDayOfMonthChange(event.target.value)}
            className="billFormInput"
          >
            {Array.from({ length: 31 }, (_, index) => {
              const day = index + 1;
              return (
                <option key={day} value={String(day)}>
                  {day}
                </option>
              );
            })}
          </select>
        </label>
      )}

      <div className="autopayToggleRow">
        <div>
          <label htmlFor="bill-autopay" className="autopayToggleLabel">
            Autopay
          </label>
          <p className="autopayToggleHelpText">
            If enabled, this bill will be auto-marked paid on its due date when someone opens the app.
          </p>
        </div>
        <input
          id="bill-autopay"
          type="checkbox"
          checked={autopay}
          onChange={(event) => onAutopayChange(event.target.checked)}
          className="autopayToggleCheckbox"
        />
      </div>

      <label className="billFormFieldLabel">
        Account Last 4 (optional)
        <input
          value={accountLast4}
          onChange={(event) => onAccountLast4Change(event.target.value.replace(/\D/g, "").slice(0, 4))}
          maxLength={4}
          inputMode="numeric"
          pattern="[0-9]*"
          className="billFormInput billAccountLast4Input"
        />
      </label>

      {billError ? <p className="billFormError">{billError}</p> : null}

      <button type="submit" disabled={billBusy} className="billFormSubmitBtn">
        {billBusy ? "Saving..." : "Add Bill"}
      </button>
    </form>
  );
}
