import { useEffect, useMemo, useRef, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import BillDetailsModal, { type BillDetailsSaveInput } from "./BillDetailsModal";
import { db } from "../lib/firebase";
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

const SHEET_CLOSE_DRAG_THRESHOLD = 80;
const SHEET_CLOSE_VELOCITY_THRESHOLD = 0.6;

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
  const today = new Date();
  const isToday = (cellDate: Date) =>
    cellDate.getFullYear() === today.getFullYear() &&
    cellDate.getMonth() === today.getMonth() &&
    cellDate.getDate() === today.getDate();
  const [viewedMonthDate, setViewedMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<BillListItem | null>(null);
  const [isBillDetailsOpen, setIsBillDetailsOpen] = useState(false);
  const [billDetailsMode, setBillDetailsMode] = useState<"view" | "edit">("view");
  const [billDetailsBusy, setBillDetailsBusy] = useState(false);
  const [billDetailsError, setBillDetailsError] = useState<string | null>(null);
  const [sheetDragY, setSheetDragY] = useState(0);
  const [isSheetDragging, setIsSheetDragging] = useState(false);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragStartYRef = useRef(0);
  const dragYRef = useRef(0);
  const dragVelocityRef = useRef(0);
  const dragLastYRef = useRef(0);
  const dragLastTimeRef = useRef(0);

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
    const todayStart = startOfDay(new Date());
    const todayYear = todayStart.getFullYear();
    const todayMonth = todayStart.getMonth();
    const todayStartTime = todayStart.getTime();

    for (const bill of bills) {
      if (bill.recurrence === "monthly") {
        const recurringDueDate = getRecurringDueDateInViewedMonth(viewedYear, viewedMonth, bill.dayOfMonth);
        if (!recurringDueDate) {
          continue;
        }

        const isPaid = bill.paidForMonth === viewedYYYYMM;
        const isFutureMonth = isMonthInFuture(viewedYear, viewedMonth, todayYear, todayMonth);
        const isOverdue = !isPaid && !isFutureMonth && startOfDay(recurringDueDate).getTime() < todayStartTime;

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
      const isOverdue = !isPaid && startOfDay(oneTimeDueDate).getTime() < todayStartTime;

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
  }, [bills, viewedMonth, viewedYYYYMM, viewedYear]);

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
    setSheetDragY(0);
    dragYRef.current = 0;
    setIsSheetDragging(false);
    dragPointerIdRef.current = null;
  };

  const openBillDetails = (bill: BillListItem) => {
    setSelectedBill(bill);
    setBillDetailsMode("view");
    setBillDetailsError(null);
    setIsBillDetailsOpen(true);
  };

  const closeBillDetails = () => {
    setIsBillDetailsOpen(false);
    setBillDetailsMode("view");
    setBillDetailsError(null);
  };

  const editBillDetails = () => {
    if (!selectedBill) {
      return;
    }

    setBillDetailsError(null);
    setBillDetailsMode("edit");
  };

  const cancelBillDetailsEdit = () => {
    setBillDetailsError(null);
    setBillDetailsMode("view");
  };

  const saveBillDetails = async (payload: BillDetailsSaveInput) => {
    if (!familyId || !selectedBill) {
      return;
    }

    setBillDetailsError(null);
    setBillDetailsBusy(true);

    const billRef = doc(db, "families", familyId, "bills", selectedBill.id);
    try {
      if (payload.kind === "one-time") {
        await updateDoc(billRef, {
          name: payload.name,
          amount: payload.amount,
          dueDate: payload.dueDate || null,
          status: payload.status,
          category: payload.category,
          autopay: payload.autopay,
          accountLast4: payload.accountLast4,
          updatedAt: serverTimestamp(),
        });

        setSelectedBill((prev) =>
          prev && prev.id === selectedBill.id
            ? {
                ...prev,
                name: payload.name,
                amount: payload.amount,
                dueDate: payload.dueDate || null,
                status: payload.status,
                category: payload.category,
                autopay: payload.autopay,
                accountLast4: payload.accountLast4,
              }
            : prev,
        );
      } else {
        await updateDoc(billRef, {
          name: payload.name,
          amount: payload.amount,
          recurrence: "monthly",
          dayOfMonth: payload.dayOfMonth,
          category: payload.category,
          autopay: payload.autopay,
          accountLast4: payload.accountLast4,
          updatedAt: serverTimestamp(),
        });

        setSelectedBill((prev) =>
          prev && prev.id === selectedBill.id
            ? {
                ...prev,
                name: payload.name,
                amount: payload.amount,
                recurrence: "monthly",
                dayOfMonth: payload.dayOfMonth,
                category: payload.category,
                autopay: payload.autopay,
                accountLast4: payload.accountLast4,
              }
            : prev,
        );
      }

      setBillDetailsMode("view");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update bill";
      setBillDetailsError(message);
    } finally {
      setBillDetailsBusy(false);
    }
  };

  const handleSheetHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, a, input, textarea, select")) {
      return;
    }

    dragPointerIdRef.current = event.pointerId;
    dragStartYRef.current = event.clientY;
    dragLastYRef.current = event.clientY;
    dragLastTimeRef.current = event.timeStamp;
    dragVelocityRef.current = 0;
    dragYRef.current = 0;

    setSheetDragY(0);
    setIsSheetDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSheetHeaderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isSheetDragging || dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    const deltaY = event.clientY - dragStartYRef.current;
    const nextY = deltaY > 0 ? deltaY : 0;
    const deltaTime = event.timeStamp - dragLastTimeRef.current;

    if (deltaTime > 0) {
      dragVelocityRef.current = (event.clientY - dragLastYRef.current) / deltaTime;
    }

    dragLastYRef.current = event.clientY;
    dragLastTimeRef.current = event.timeStamp;
    dragYRef.current = nextY;
    setSheetDragY(nextY);
  };

  const handleSheetHeaderPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const shouldClose =
      dragYRef.current >= SHEET_CLOSE_DRAG_THRESHOLD || dragVelocityRef.current > SHEET_CLOSE_VELOCITY_THRESHOLD;

    setIsSheetDragging(false);
    setSheetDragY(0);
    dragYRef.current = 0;
    dragPointerIdRef.current = null;

    if (shouldClose) {
      closeDaySheet();
    }
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

  useEffect(() => {
    if (!selectedBill) {
      return;
    }

    const latestSelected = bills.find((bill) => bill.id === selectedBill.id) ?? null;
    if (!latestSelected) {
      setSelectedBill(null);
      setIsBillDetailsOpen(false);
      setBillDetailsMode("view");
      setBillDetailsError(null);
      return;
    }

    setSelectedBill(latestSelected);
  }, [bills, selectedBill]);

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
            const cellDate = day == null ? null : new Date(viewedYear, viewedMonth, day);
            const isTodayCell =
              cellDate != null &&
              cellDate.getFullYear() === viewedYear &&
              cellDate.getMonth() === viewedMonth &&
              isToday(cellDate);
            const todayClass = isTodayCell ? "calendar-day--today" : "";

            return (
              <div key={`${day ?? "blank"}-${index}`} className={`calendarCell ${todayClass}`.trim()}>
                {day != null ? (
                  <button
                    type="button"
                    className="calendarDayBtn"
                    onClick={() => openDaySheet(day)}
                    aria-label={`Open bills for ${cellDate!.toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}`}
                  >
                    <div className="calendarDayNum">
                      <span>{day}</span>
                      {isTodayCell ? <span className="today-dot" aria-label="Today" /> : null}
                    </div>
                    {visibleEvents.map((event) => {
                      const payTypeClass = event.bill.autopay ? "bill-pill--autopay" : "bill-pill--manual";
                      return (
                        <div
                          key={`${event.billId}-${event.dayOfMonth}-${event.label}`}
                          className={`billChip ${
                            event.status === "paid" ? "chipPaid" : event.status === "overdue" ? "chipOverdue" : "chipUnpaid"
                          } ${payTypeClass}`}
                          title={event.label}
                        >
                          {event.label}
                        </div>
                      );
                    })}
                    {hiddenCount > 0 ? <div className="billChip chipUnpaid">+{hiddenCount} more</div> : null}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="calendar-legend" aria-label="Bill type legend">
          <span className="legend-item">
            <span className="legend-dot legend-dot--autopay" aria-hidden="true" />
            Autopay
          </span>
          <span className="legend-item">
            <span className="legend-dot legend-dot--manual" aria-hidden="true" />
            Manual
          </span>
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

          <section
            className={`bottomSheet ${isSheetDragging ? "bottomSheet--dragging" : ""}`.trim()}
            role="dialog"
            aria-modal="true"
            aria-label="Bills for selected day"
            style={{ transform: `translate(-50%, ${sheetDragY}px)` }}
          >
            <div
              className={`sheetDragHeader ${isSheetDragging ? "sheetDragHeader--dragging" : ""}`.trim()}
              onPointerDown={handleSheetHeaderPointerDown}
              onPointerMove={handleSheetHeaderPointerMove}
              onPointerUp={handleSheetHeaderPointerUp}
              onPointerCancel={handleSheetHeaderPointerUp}
            >
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
                  const hasAutopayMeta = event.bill.autopay === true;
                  const hasAccountLast4Meta =
                    typeof event.bill.accountLast4 === "string" && /^\d{4}$/.test(event.bill.accountLast4);
                  const hasMetadata = hasAutopayMeta || hasAccountLast4Meta;
                  return (
                    <li
                      key={`${event.billId}-${event.dayOfMonth}-${event.label}`}
                      className="sheetRow sheetRowClickable"
                      onClick={() => openBillDetails(event.bill)}
                      onKeyDown={(keyEvent) => {
                        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                          keyEvent.preventDefault();
                          openBillDetails(event.bill);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div>
                        <div style={{ fontWeight: 700 }}>{event.name}</div>
                        <div style={{ fontSize: "0.92rem", color: "#334155" }}>{formatCurrency(event.amount)}</div>
                        {hasMetadata ? (
                          <div className="billMeta">
                            {hasAutopayMeta ? <span className="billMetaTag">Autopay</span> : null}
                            {hasAccountLast4Meta ? <span className="billMetaText">••••{event.bill.accountLast4}</span> : null}
                          </div>
                        ) : null}
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
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            void onToggleBillStatus(event.bill, {
                              viewedYYYYMM,
                              currentStatus: event.status,
                            });
                          }}
                          onKeyDown={(keyEvent) => {
                            keyEvent.stopPropagation();
                          }}
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

      <BillDetailsModal
        open={isBillDetailsOpen}
        bill={selectedBill}
        mode={billDetailsMode}
        saving={billDetailsBusy}
        error={billDetailsError}
        onClose={closeBillDetails}
        onEdit={editBillDetails}
        onCancelEdit={cancelBillDetailsEdit}
        onSaved={saveBillDetails}
      />
    </>
  );
}
