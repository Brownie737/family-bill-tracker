import { useEffect, useMemo, useState } from "react";
import type { BillListItem } from "../lib/firestore";

type BillsCalendarProps = {
  bills: BillListItem[];
  familyId: string | null;
  statusBusyBillId: string | null;
  onToggleBillStatus: (
    bill: BillListItem,
    context: { viewedYYYYMM: string; currentStatus: ChipStatus },
  ) => Promise<void> | void;
};

type ChipStatus = "paid" | "unpaid" | "overdue";

type CalendarEvent = {
  billId: string;
  dayOfMonth: number;
  status: ChipStatus;
  bill: BillListItem;
  name: string;
  amount: number;
  label: string;
  sortTime: number;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseYYYYMMDD(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
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

function getYYYYMM(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function isMonthInFuture(viewYear: number, viewMonth: number, todayYear: number, todayMonth: number): boolean {
  return viewYear > todayYear || (viewYear === todayYear && viewMonth > todayMonth);
}

function getRecurringDueDateInViewedMonth(year: number, month: number, dayOfMonth: number | null | undefined): Date | null {
  if (typeof dayOfMonth !== "number" || !Number.isInteger(dayOfMonth)) {
    return null;
  }

  const lastDay = new Date(year, month + 1, 0).getDate();
  const clamped = Math.min(Math.max(dayOfMonth, 1), lastDay);
  return new Date(year, month, clamped);
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function BillsCalendar({ bills, familyId, statusBusyBillId, onToggleBillStatus }: BillsCalendarProps) {
  const now = new Date();
  const today = startOfDay(now);
  const [viewedMonthDate, setViewedMonthDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const viewedYear = viewedMonthDate.getFullYear();
  const viewedMonth = viewedMonthDate.getMonth();
  const viewedYYYYMM = getYYYYMM(viewedMonthDate);

  const monthLabel = useMemo(
    () =>
      viewedMonthDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),
    [viewedMonthDate],
  );

  const selectedDateLabel = useMemo(() => {
    if (selectedDayOfMonth == null) {
      return "";
    }

    const selectedDate = new Date(viewedYear, viewedMonth, selectedDayOfMonth);
    return selectedDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [selectedDayOfMonth, viewedMonth, viewedYear]);

  const firstWeekday = new Date(viewedYear, viewedMonth, 1).getDay();
  const daysInMonth = new Date(viewedYear, viewedMonth + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const trailingBlanks = totalCells - (firstWeekday + daysInMonth);

  const dayCells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ...Array.from({ length: trailingBlanks }, () => null),
  ];

  const eventsByDay = useMemo(() => {
    const events = new Map<number, CalendarEvent[]>();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();

    for (const bill of bills) {
      if (bill.recurrence === "monthly") {
        const recurringDueDate = getRecurringDueDateInViewedMonth(viewedYear, viewedMonth, bill.dayOfMonth);
        if (!recurringDueDate) {
          continue;
        }

        const isPaid = bill.paidForMonth === viewedYYYYMM;
        const isFutureMonth = isMonthInFuture(viewedYear, viewedMonth, todayYear, todayMonth);
        const isOverdue = !isPaid && !isFutureMonth && startOfDay(recurringDueDate).getTime() < today.getTime();

        const event: CalendarEvent = {
          billId: bill.id,
          dayOfMonth: recurringDueDate.getDate(),
          status: isPaid ? "paid" : isOverdue ? "overdue" : "unpaid",
          bill,
          name: bill.name,
          amount: bill.amount,
          label: `${bill.name} • $${bill.amount.toFixed(2)}`,
          sortTime: recurringDueDate.getTime(),
        };

        const existing = events.get(event.dayOfMonth) ?? [];
        existing.push(event);
        events.set(event.dayOfMonth, existing);
        continue;
      }

      if (!bill.dueDate) {
        continue;
      }

      const oneTimeDueDate = parseYYYYMMDD(bill.dueDate);
      if (!oneTimeDueDate) {
        continue;
      }

      if (oneTimeDueDate.getFullYear() !== viewedYear || oneTimeDueDate.getMonth() !== viewedMonth) {
        continue;
      }

      const isPaid = bill.status === "paid";
      const isOverdue = !isPaid && startOfDay(oneTimeDueDate).getTime() < today.getTime();

      const event: CalendarEvent = {
        billId: bill.id,
        dayOfMonth: oneTimeDueDate.getDate(),
        status: isPaid ? "paid" : isOverdue ? "overdue" : "unpaid",
        bill,
        name: bill.name,
        amount: bill.amount,
        label: `${bill.name} • $${bill.amount.toFixed(2)}`,
        sortTime: oneTimeDueDate.getTime(),
      };

      const existing = events.get(event.dayOfMonth) ?? [];
      existing.push(event);
      events.set(event.dayOfMonth, existing);
    }

    for (const [day, dayEvents] of events) {
      dayEvents.sort((a, b) => {
        if (a.sortTime !== b.sortTime) {
          return a.sortTime - b.sortTime;
        }
        return a.label.localeCompare(b.label);
      });
      events.set(day, dayEvents);
    }

    return events;
  }, [bills, today, viewedMonth, viewedYYYYMM, viewedYear]);

  const selectedDayEvents = useMemo(() => {
    if (selectedDayOfMonth == null) {
      return [] as CalendarEvent[];
    }
    return eventsByDay.get(selectedDayOfMonth) ?? [];
  }, [eventsByDay, selectedDayOfMonth]);

  const openDaySheet = (dayOfMonth: number) => {
    setSelectedDayOfMonth(dayOfMonth);
    setIsSheetOpen(true);
  };

  const closeDaySheet = () => {
    setIsSheetOpen(false);
  };

  useEffect(() => {
    if (!isSheetOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDaySheet();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSheetOpen]);

  return (
    <>
      <section className="calendarShell" aria-label="Bills calendar">
        <div className="calendarHeader">
          <button
            type="button"
            className="tabBtn"
            onClick={() => {
              setViewedMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
              closeDaySheet();
            }}
            aria-label="Previous month"
          >
            ◀
          </button>
          <h2>{monthLabel}</h2>
          <button
            type="button"
            className="tabBtn"
            onClick={() => {
              setViewedMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
              closeDaySheet();
            }}
            aria-label="Next month"
          >
            ▶
          </button>
        </div>

        <div className="calendarDowRow" role="row">
          {DOW_LABELS.map((dow) => (
            <div key={dow}>{dow}</div>
          ))}
        </div>

        <div className="calendarGrid">
          {dayCells.map((day, index) => {
            const dayEvents = day == null ? [] : eventsByDay.get(day) ?? [];
            const visibleEvents = dayEvents.slice(0, 3);
            const hiddenCount = Math.max(0, dayEvents.length - visibleEvents.length);

            return (
              <div key={`${day ?? "blank"}-${index}`} className="calendarCell">
                {day != null ? (
                  <button
                    type="button"
                    className="calendarDayBtn"
                    onClick={() => openDaySheet(day)}
                    aria-label={`Open bills for ${new Date(viewedYear, viewedMonth, day).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}`}
                  >
                    <div className="calendarDayNum">{day}</div>
                    {visibleEvents.map((event) => (
                      <div
                        key={`${event.billId}-${event.dayOfMonth}-${event.label}`}
                        className={`billChip ${
                          event.status === "paid" ? "chipPaid" : event.status === "overdue" ? "chipOverdue" : "chipUnpaid"
                        }`}
                        title={event.label}
                      >
                        {event.label}
                      </div>
                    ))}
                    {hiddenCount > 0 ? <div className="billChip chipUnpaid">+{hiddenCount} more</div> : null}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {isSheetOpen && selectedDayOfMonth != null ? (
        <>
          <button
            type="button"
            className="sheetBackdrop"
            aria-label="Close bills drawer"
            onClick={closeDaySheet}
          />

          <section className="bottomSheet" role="dialog" aria-modal="true" aria-label="Bills for selected day">
            <div className="sheetHandle" aria-hidden="true" />

            <div className="sheetHeader">
              <h3>{selectedDateLabel}</h3>
              <button
                type="button"
                className="sheetToggleBtn"
                aria-label="Close bills drawer"
                onClick={closeDaySheet}
              >
                ✕
              </button>
            </div>

            <ul className="sheetList">
              {selectedDayEvents.length === 0 ? (
                <li className="sheetRow" aria-label="No bills for selected day">
                  <div>
                    <strong>No bills for this date</strong>
                    <div style={{ color: "#64748b", fontSize: "0.9rem" }}>Nothing due or scheduled on this day.</div>
                  </div>
                </li>
              ) : (
                selectedDayEvents.map((event) => {
                  const nextActionLabel = event.status === "paid" ? "Mark unpaid" : "Mark paid";
                  const isBusy = statusBusyBillId === event.bill.id;
                  return (
                    <li key={`${event.billId}-${event.dayOfMonth}-${event.label}`} className="sheetRow">
                      <div>
                        <div style={{ fontWeight: 700 }}>{event.name}</div>
                        <div style={{ fontSize: "0.92rem", color: "#334155" }}>{formatCurrency(event.amount)}</div>
                      </div>

                      <div style={{ display: "grid", justifyItems: "end", gap: 8 }}>
                        <span
                          className={`sheetBadge ${
                            event.status === "paid"
                              ? "sheetBadgePaid"
                              : event.status === "overdue"
                                ? "sheetBadgeOverdue"
                                : "sheetBadgeUnpaid"
                          }`}
                          aria-label={`Status ${event.status}`}
                        >
                          {event.status === "paid" ? "Paid" : event.status === "overdue" ? "Overdue" : "Unpaid"}
                        </span>
                        <button
                          type="button"
                          className="sheetToggleBtn"
                          disabled={isBusy || !familyId}
                          onClick={() =>
                            onToggleBillStatus(event.bill, {
                              viewedYYYYMM,
                              currentStatus: event.status,
                            })
                          }
                          aria-label={`${nextActionLabel} for ${event.name}`}
                        >
                          {isBusy ? "Saving..." : nextActionLabel}
                        </button>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        </>
      ) : null}
    </>
  );
}
