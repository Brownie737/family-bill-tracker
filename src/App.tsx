import { useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { auth, db } from "./lib/firebase";
import {
  addBill,
  BILL_CATEGORIES,
  createFamilyForUser,
  ensureUserDoc,
  joinFamily,
  listenToBills,
  normalizeBillCategory,
  listenToUserFamilyId,
  toggleBillStatus,
} from "./lib/firestore";
import type { BillCategory, BillListItem } from "./lib/firestore";
import AvatarMenu from "./components/AvatarMenu";
import AddBillForm from "./components/AddBillForm";
import BillsCalendar from "./components/BillsCalendar";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [createdFamilyId, setCreatedFamilyId] = useState<string | null>(null);
  const [joinFamilyId, setJoinFamilyId] = useState("");
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [familyBusy, setFamilyBusy] = useState(false);

  const [billName, setBillName] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billType, setBillType] = useState<"one-time" | "monthly">("one-time");
  const [billCategory, setBillCategory] = useState<BillCategory>("Subscriptions");
  const [billDueDate, setBillDueDate] = useState("");
  const [billDayOfMonth, setBillDayOfMonth] = useState("1");
  const [autopay, setAutopay] = useState(true);
  const [accountLast4, setAccountLast4] = useState("");
  const [billError, setBillError] = useState<string | null>(null);
  const [billBusy, setBillBusy] = useState(false);
  const [bills, setBills] = useState<BillListItem[]>([]);
  const [statusBusyBillId, setStatusBusyBillId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "calendar">("summary");
  const [isBillsMenuOpen, setIsBillsMenuOpen] = useState(false);
  const [isAddBillModalOpen, setIsAddBillModalOpen] = useState(false);
  const [billsCategoryFilter, setBillsCategoryFilter] = useState<string>("All");
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
  const autopayProcessedKeysRef = useRef<Set<string>>(new Set());
  const billsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setFamilyId(null);
      setCreatedFamilyId(null);
      setJoinFamilyId("");
      setBills([]);
      setIsBillsMenuOpen(false);
      setIsAddBillModalOpen(false);
      setIsDeleteMode(false);
      setSelectedBillIds(new Set());
      setBillCategory("Subscriptions");
      return;
    }

    let active = true;
    ensureUserDoc(user.uid, user.email).catch((err: unknown) => {
      if (!active) {
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to initialize user profile";
      setFamilyError(message);
    });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setFamilyId(null);
      return;
    }

    const unsub = listenToUserFamilyId(user.uid, (nextFamilyId) => {
      setFamilyId(nextFamilyId);
    });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!familyId) {
      setBills([]);
      setIsDeleteMode(false);
      setSelectedBillIds(new Set());
      return;
    }

    const unsub = listenToBills(familyId, (nextBills) => {
      setBills(nextBills);
    });

    return () => unsub();
  }, [familyId]);

  useEffect(() => {
    if (!isBillsMenuOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!billsMenuRef.current?.contains(target)) {
        setIsBillsMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("touchstart", handleOutsideClick);

    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [isBillsMenuOpen]);

  useEffect(() => {
    if (!isBillsMenuOpen && !isAddBillModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setIsBillsMenuOpen(false);
      setIsAddBillModalOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isAddBillModalOpen, isBillsMenuOpen]);

  useEffect(() => {
    if (activeTab !== "calendar") {
      return;
    }

    setIsBillsMenuOpen(false);
    setIsDeleteMode(false);
    setSelectedBillIds(new Set());
  }, [activeTab]);

  useEffect(() => {
    if (selectedBillIds.size === 0) {
      return;
    }

    const validBillIds = new Set(bills.map((bill) => bill.id));
    setSelectedBillIds((prev) => {
      let changed = false;
      const next = new Set<string>();

      prev.forEach((id) => {
        if (validBillIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [bills, selectedBillIds.size]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setEmail("");
      setPassword("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
  }

  async function handleCreateFamily() {
    if (!user) {
      return;
    }

    setFamilyError(null);
    setFamilyBusy(true);
    try {
      const newFamilyId = await createFamilyForUser(user.uid, user.email);
      setFamilyId(newFamilyId);
      setCreatedFamilyId(newFamilyId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create family";
      setFamilyError(message);
    } finally {
      setFamilyBusy(false);
    }
  }

  async function handleJoinFamily() {
    if (!user) {
      return;
    }

    const normalizedFamilyId = joinFamilyId.trim();
    if (!normalizedFamilyId) {
      setFamilyError("Enter a family ID");
      return;
    }

    setFamilyError(null);
    setFamilyBusy(true);
    try {
      const joinedFamilyId = await joinFamily(user.uid, user.email, normalizedFamilyId);
      setFamilyId(joinedFamilyId);
      setCreatedFamilyId(null);
      setJoinFamilyId("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to join family";
      setFamilyError(message);
    } finally {
      setFamilyBusy(false);
    }
  }

  async function handleAddBill(e: React.FormEvent) {
    e.preventDefault();

    if (!user || !familyId) {
      return;
    }

    const name = billName.trim();
    const amount = Number(billAmount);
    if (!name) {
      setBillError("Bill name is required");
      return;
    }

    if (!Number.isFinite(amount)) {
      setBillError("Amount must be a valid number");
      return;
    }

    const normalizedLast4 = accountLast4.replace(/\D/g, "");
    const normalizedLast4OrNull = normalizedLast4.length === 0 ? null : normalizedLast4;
    const normalizedCategory = normalizeBillCategory(billCategory, "Subscriptions");
    if (normalizedLast4OrNull !== null && normalizedLast4OrNull.length !== 4) {
      setBillError("Account Last 4 must be exactly 4 digits");
      return;
    }

    setBillError(null);
    setBillBusy(true);
    try {
      if (billType === "monthly") {
        const dayOfMonth = Number.parseInt(billDayOfMonth, 10);
        if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
          setBillError("Day of month must be between 1 and 31");
          return;
        }

        await addBill(familyId, user.uid, {
          name,
          amount,
          recurrence: "monthly",
          dayOfMonth,
          category: normalizedCategory,
          autopay,
          accountLast4: normalizedLast4OrNull,
        });
      } else {
        await addBill(familyId, user.uid, {
          name,
          amount,
          dueDate: billDueDate.trim(),
          category: normalizedCategory,
          autopay,
          accountLast4: normalizedLast4OrNull,
        });
      }

      setBillName("");
      setBillAmount("");
      setBillCategory("Subscriptions");
      setBillDueDate("");
      setBillDayOfMonth("1");
      setAutopay(true);
      setAccountLast4("");
      setIsAddBillModalOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add bill";
      setBillError(message);
    } finally {
      setBillBusy(false);
    }
  }

  function handleOpenAddBillModal() {
    setIsBillsMenuOpen(false);
    setIsDeleteMode(false);
    setSelectedBillIds(new Set());
    setBillCategory("Subscriptions");
    setIsAddBillModalOpen(true);
  }

  function handleEnterDeleteMode() {
    setIsBillsMenuOpen(false);
    setIsAddBillModalOpen(false);
    setIsDeleteMode(true);
    setSelectedBillIds(new Set());
  }

  function handleCancelDeleteMode() {
    setIsDeleteMode(false);
    setSelectedBillIds(new Set());
  }

  function handleDeleteSelectionChange(billId: string, checked: boolean) {
    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(billId);
      } else {
        next.delete(billId);
      }
      return next;
    });
  }

  async function handleDeleteSelectedBills() {
    if (!familyId || selectedBillIds.size === 0) {
      return;
    }

    const idsToDelete = [...selectedBillIds];
    const selectedBills = bills.filter((bill) => selectedBillIds.has(bill.id));
    const confirmationMessage =
      idsToDelete.length === 1
        ? `Delete '${selectedBills[0]?.name ?? ""}'?`
        : `Delete ${idsToDelete.length} bills?`;

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setBillError(null);
    setDeleteBusy(true);
    try {
      await Promise.all(idsToDelete.map((billId) => deleteDoc(doc(db, "families", familyId, "bills", billId))));
      setIsDeleteMode(false);
      setSelectedBillIds(new Set());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete selected bills";
      setBillError(message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleToggleBillStatusWithContext(
    bill: BillListItem,
    context?: { viewedYYYYMM?: string; currentStatus?: "paid" | "unpaid" | "overdue" },
  ) {
    if (!familyId) {
      return;
    }

    const currentStatus = context?.currentStatus ?? getDerivedStatus(bill);
    const normalizedCurrentStatus = currentStatus === "paid" ? "paid" : "unpaid";
    const nextStatus = normalizedCurrentStatus === "paid" ? "unpaid" : "paid";
    const effectiveYYYYMM = context?.viewedYYYYMM ?? currentYYYYMM;

    setBillError(null);
    setStatusBusyBillId(bill.id);
    try {
      await toggleBillStatus(familyId, bill.id, nextStatus, {
        recurrence: bill.recurrence ?? null,
        currentYYYYMM: effectiveYYYYMM,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update bill status";
      setBillError(message);
    } finally {
      setStatusBusyBillId(null);
    }
  }

  const formatCurrency = (amount: number) =>
    amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });

  const now = new Date();
  const nowMonth = now.getMonth();
  const nowYear = now.getFullYear();
  const currentYYYYMM = `${nowYear}-${String(nowMonth + 1).padStart(2, "0")}`;

  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const parseYYYYMMDD = (dueDate: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return null;
    }

    const [y, m, d] = dueDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);

    if (
      !Number.isInteger(y) ||
      !Number.isInteger(m) ||
      !Number.isInteger(d) ||
      dt.getFullYear() !== y ||
      dt.getMonth() !== m - 1 ||
      dt.getDate() !== d
    ) {
      return null;
    }

    return dt;
  };

  const getDerivedStatus = (bill: BillListItem) => {
    if (bill.recurrence === "monthly") {
      return bill.paidForMonth === currentYYYYMM ? "paid" : "unpaid";
    }

    return bill.status;
  };

  const parseOneTimeDueDate = (dueDate: string | null | undefined) => {
    if (!dueDate) {
      return Number.POSITIVE_INFINITY;
    }

    const dt = parseYYYYMMDD(dueDate);
    if (!dt) {
      return Number.POSITIVE_INFINITY;
    }

    return dt.getTime();
  };

  const getRecurringDueDateInCurrentMonth = (dayOfMonth: number | null | undefined): Date | null => {
    if (typeof dayOfMonth !== "number" || !Number.isInteger(dayOfMonth)) {
      return null;
    }

    const lastDay = new Date(nowYear, nowMonth + 1, 0).getDate();
    const clampedDay = Math.min(Math.max(dayOfMonth, 1), lastDay);
    return new Date(nowYear, nowMonth, clampedDay);
  };

  const todayStart = startOfDay(now);

  useEffect(() => {
    autopayProcessedKeysRef.current.clear();
  }, [familyId]);

  useEffect(() => {
    if (!familyId || bills.length === 0) {
      return;
    }

    let cancelled = false;

    const runAutopay = async () => {
      const processedKeys = autopayProcessedKeysRef.current;

      for (const bill of bills) {
        if (cancelled) {
          return;
        }

        if (bill.autopay !== true) {
          continue;
        }

        if (bill.recurrence === "monthly") {
          if (bill.paidForMonth === currentYYYYMM) {
            continue;
          }

          const recurringDueDate = getRecurringDueDateInCurrentMonth(bill.dayOfMonth);
          if (!recurringDueDate || startOfDay(recurringDueDate).getTime() > todayStart.getTime()) {
            continue;
          }

          const recurringKey = `${bill.id}:${currentYYYYMM}`;
          if (processedKeys.has(recurringKey)) {
            continue;
          }

          const billRef = doc(db, "families", familyId, "bills", bill.id);
          try {
            await updateDoc(billRef, {
              paidForMonth: currentYYYYMM,
              updatedAt: serverTimestamp(),
            });
          } catch {
            // Intentionally ignored. Key is still marked to prevent write loops.
          } finally {
            processedKeys.add(recurringKey);
          }

          continue;
        }

        if (bill.status === "paid" || !bill.dueDate) {
          continue;
        }

        const oneTimeDueDate = parseYYYYMMDD(bill.dueDate);
        if (!oneTimeDueDate || startOfDay(oneTimeDueDate).getTime() > todayStart.getTime()) {
          continue;
        }

        const oneTimeKey = `${bill.id}:${bill.dueDate}`;
        if (processedKeys.has(oneTimeKey)) {
          continue;
        }

        const billRef = doc(db, "families", familyId, "bills", bill.id);
        try {
          await updateDoc(billRef, {
            status: "paid",
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Intentionally ignored. Key is still marked to prevent write loops.
        } finally {
          processedKeys.add(oneTimeKey);
        }
      }
    };

    void runAutopay();

    return () => {
      cancelled = true;
    };
  }, [familyId, bills]);

  const isOverdue = (bill: BillListItem) => {
    if (getDerivedStatus(bill) !== "unpaid") {
      return false;
    }

    const dueDate =
      bill.recurrence === "monthly"
        ? getRecurringDueDateInCurrentMonth(bill.dayOfMonth)
        : bill.dueDate
          ? parseYYYYMMDD(bill.dueDate)
          : null;

    if (!dueDate) {
      return false;
    }

    return startOfDay(dueDate).getTime() < todayStart.getTime();
  };

  const sortedBills = [...bills].sort((a, b) => {
    const statusOrderA = getDerivedStatus(a) === "unpaid" ? 0 : 1;
    const statusOrderB = getDerivedStatus(b) === "unpaid" ? 0 : 1;
    if (statusOrderA !== statusOrderB) {
      return statusOrderA - statusOrderB;
    }

    const dueA =
      a.recurrence === "monthly"
        ? (getRecurringDueDateInCurrentMonth(a.dayOfMonth)?.getTime() ?? Number.POSITIVE_INFINITY)
        : parseOneTimeDueDate(a.dueDate);
    const dueB =
      b.recurrence === "monthly"
        ? (getRecurringDueDateInCurrentMonth(b.dayOfMonth)?.getTime() ?? Number.POSITIVE_INFINITY)
        : parseOneTimeDueDate(b.dueDate);
    if (dueA !== dueB) {
      return dueA - dueB;
    }

    return a.name.localeCompare(b.name);
  });

  const visibleBills = sortedBills.filter((bill) => {
    const cat = bill.category?.trim() ? bill.category : "Uncategorized";
    if (billsCategoryFilter !== "All") {
      return cat === billsCategoryFilter;
    }

    return true;
  });

  const { dueThisMonthTotal, paidThisMonthTotal, overdueTotal } = bills.reduce(
    (totals, bill) => {
      const isRecurring = bill.recurrence === "monthly";
      const recurringDueDate = isRecurring ? getRecurringDueDateInCurrentMonth(bill.dayOfMonth) : null;
      const oneTimeDueDate = !isRecurring && bill.dueDate ? parseYYYYMMDD(bill.dueDate) : null;
      const oneTimeIsCurrentMonth =
        oneTimeDueDate !== null &&
        oneTimeDueDate.getMonth() === nowMonth &&
        oneTimeDueDate.getFullYear() === nowYear;

      if (isRecurring) {
        if (recurringDueDate) {
          totals.dueThisMonthTotal += bill.amount;
        }

        if (bill.paidForMonth === currentYYYYMM) {
          totals.paidThisMonthTotal += bill.amount;
        }
      } else if (oneTimeIsCurrentMonth) {
        totals.dueThisMonthTotal += bill.amount;

        if (bill.status === "paid") {
          totals.paidThisMonthTotal += bill.amount;
        }
      }

      if (isOverdue(bill)) {
        totals.overdueTotal += bill.amount;
      }

      return totals;
    },
    {
      dueThisMonthTotal: 0,
      paidThisMonthTotal: 0,
      overdueTotal: 0,
    },
  );

  const remainingThisMonthTotal = Math.max(0, dueThisMonthTotal - paidThisMonthTotal);

  if (user) {
    return (
      <div className="appShell" style={{ fontFamily: "system-ui" }}>
        <header className="topBar">
          <div className="topBarInner">
            <div className="topBarTitles">
              <h1 className="topBarTitle">Family Bill Tracker</h1>
              <p className="topBarSubtitle">Shared household billing dashboard</p>
            </div>
            <AvatarMenu email={user.email ?? ""} familyId={familyId ?? ""} onLogout={handleLogout} />
          </div>
        </header>

        <main className="appMain">
          {!familyId ? (
            <section className="surfaceCard">
              <h2 className="cardHeading">Family Setup</h2>

            <button onClick={handleCreateFamily} disabled={familyBusy} style={{ padding: "10px 12px" }}>
              {familyBusy ? "Working..." : "Create Family"}
            </button>

            {createdFamilyId && (
              <p style={{ marginTop: 12, marginBottom: 16 }}>
                Created Family ID: <code style={{ userSelect: "all" }}>{createdFamilyId}</code>
              </p>
            )}

            <div style={{ display: "grid", gap: 8 }}>
              <label htmlFor="join-family-id">Join existing family</label>
              <input
                id="join-family-id"
                value={joinFamilyId}
                onChange={(e) => setJoinFamilyId(e.target.value)}
                placeholder="Enter family ID"
                style={{ width: "100%", padding: 10 }}
              />
              <button onClick={handleJoinFamily} disabled={familyBusy} style={{ padding: "10px 12px" }}>
                {familyBusy ? "Working..." : "Join Family"}
              </button>
            </div>

              {familyError && <p style={{ color: "crimson", marginBottom: 0 }}>{familyError}</p>}
            </section>
          ) : (
            <section className="dashboardStack">
              <div className="tabsBar" role="tablist" aria-label="Dashboard tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "summary"}
                  className={`tabBtn ${activeTab === "summary" ? "tabBtnActive" : ""}`}
                  onClick={() => setActiveTab("summary")}
                >
                  Overview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "calendar"}
                  className={`tabBtn ${activeTab === "calendar" ? "tabBtnActive" : ""}`}
                  onClick={() => setActiveTab("calendar")}
                >
                  Calendar
                </button>
              </div>

              {activeTab === "summary" ? (
                <>
                  <div className="surfaceCard">
                    <h2 className="cardHeading">Summary</h2>
                    <div className="summaryGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                      <div className="summaryMetricCard">
                        <div className="summaryMetricLabel">Due This Month</div>
                        <div className="summaryMetricValue">{formatCurrency(dueThisMonthTotal)}</div>
                      </div>
                      <div className="summaryMetricCard">
                        <div className="summaryMetricLabel">Paid This Month</div>
                        <div className="summaryMetricValue">{formatCurrency(paidThisMonthTotal)}</div>
                      </div>
                      <div className="summaryMetricCard">
                        <div className="summaryMetricLabel">Remaining This Month</div>
                        <div className="summaryMetricValue">{formatCurrency(remainingThisMonthTotal)}</div>
                      </div>
                    </div>
                    <div className="summaryMetricCard" style={{ marginTop: 12 }}>
                      <div className="summaryMetricLabel">Overdue Total</div>
                      <div className="summaryMetricValue">{formatCurrency(overdueTotal)}</div>
                    </div>
                  </div>
 
                  <div className="surfaceCard billsCard">
                  <div className="billsHeaderRow">
                    <h2 className="cardHeading billsTitle">Bills</h2>
                    <div className="billsHeader">
                      <select
                        value={billsCategoryFilter}
                        onChange={(event) => setBillsCategoryFilter(event.target.value)}
                        className="billsFilterPill"
                        aria-label="Filter bills by category"
                      >
                        <option value="All">All</option>
                        {BILL_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                      <div className="billsMenuRoot" ref={billsMenuRef}>
                        <button
                          type="button"
                          className="billsMenuButton"
                          aria-label="Open bills actions"
                          aria-haspopup="menu"
                          aria-expanded={isBillsMenuOpen}
                          onClick={() => setIsBillsMenuOpen((prev) => !prev)}
                        >
                          ⋯
                        </button>

                        {isBillsMenuOpen ? (
                          <div className="billsMenuPopover" role="menu" aria-label="Bills actions menu">
                            <button type="button" role="menuitem" className="billsMenuItem" onClick={handleOpenAddBillModal}>
                              Add bill
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="billsMenuItem billsMenuItemDanger"
                              onClick={handleEnterDeleteMode}
                            >
                              Delete bill
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {isDeleteMode ? (
                    <div className="billsDeleteToolbar" role="toolbar" aria-label="Delete bills toolbar">
                      <span className="billsDeleteToolbarLabel">Select bills to delete</span>
                      <div className="billsDeleteToolbarActions">
                        <button type="button" className="tabBtn" onClick={handleCancelDeleteMode} disabled={deleteBusy}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="billsDeleteConfirmBtn"
                          disabled={selectedBillIds.size === 0 || deleteBusy}
                          onClick={handleDeleteSelectedBills}
                        >
                          {deleteBusy ? "Deleting..." : "Delete Selected"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {visibleBills.length === 0 ? (
                    <p style={{ marginBottom: 0 }}>No bills yet.</p>
                  ) : (
                    <ul className="billList">
                      {visibleBills.map((bill) => (
                        <li key={bill.id} className="billListItem">
                          {(() => {
                            const derivedStatus = getDerivedStatus(bill);
                            const overdue = isOverdue(bill);
                            const hasAutopayMeta = bill.autopay === true;
                            const hasAccountLast4Meta =
                              typeof bill.accountLast4 === "string" && /^\d{4}$/.test(bill.accountLast4);
                            const hasMetadata = hasAutopayMeta || hasAccountLast4Meta;
                            const dueText =
                              bill.recurrence === "monthly"
                                ? `Due day ${bill.dayOfMonth ?? "?"} of each month`
                                : `Due: ${bill.dueDate ?? "No due date"}`;

                            const badgeLabel = derivedStatus === "paid" ? "PAID" : overdue ? "OVERDUE" : "UNPAID";
                            const badgeBackground =
                              badgeLabel === "PAID" ? "#e6f6ea" : badgeLabel === "OVERDUE" ? "#fde8e8" : "#f3f4f6";
                            const badgeColor =
                              badgeLabel === "PAID" ? "#0f5132" : badgeLabel === "OVERDUE" ? "#b42318" : "#374151";

                            return (
                              <div className="billRowContainer">
                                {isDeleteMode ? (
                                  <label className="billDeleteCheckboxWrap">
                                    <input
                                      type="checkbox"
                                      className="billDeleteCheckbox"
                                      checked={selectedBillIds.has(bill.id)}
                                      onChange={(event) => handleDeleteSelectionChange(bill.id, event.target.checked)}
                                      aria-label={`Select ${bill.name} for deletion`}
                                    />
                                  </label>
                                ) : null}

                                <div className="billRowMain">
                                  <div className="billRowDetails">
                                    <b>{bill.name}</b>
                                    <div className="billAmount">${bill.amount.toFixed(2)}</div>
                                    <div className="billDueText">{dueText}</div>
                                    {hasMetadata ? (
                                      <div className="billMeta">
                                        {hasAutopayMeta ? <span className="billMetaTag">Autopay</span> : null}
                                        {hasAccountLast4Meta ? <span className="billMetaText">••••{bill.accountLast4}</span> : null}
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="billRowActions">
                                    <span
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 600,
                                        padding: "4px 8px",
                                        borderRadius: 999,
                                        background: badgeBackground,
                                        color: badgeColor,
                                      }}
                                    >
                                      {badgeLabel}
                                    </span>
                                    <button
                                      type="button"
                                      className="billStatusBtn"
                                      onClick={() =>
                                        handleToggleBillStatusWithContext(bill, {
                                          viewedYYYYMM: currentYYYYMM,
                                          currentStatus: derivedStatus,
                                        })
                                      }
                                      disabled={statusBusyBillId === bill.id || isDeleteMode || deleteBusy}
                                    >
                                      {statusBusyBillId === bill.id ? "Saving..." : derivedStatus === "paid" ? "Mark Unpaid" : "Mark Paid"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </li>
                      ))}
                    </ul>
                  )}

                  {billError ? <p className="billFormError">{billError}</p> : null}
                  </div>
                </>
              ) : (
                <BillsCalendar
                  bills={bills}
                  familyId={familyId}
                  statusBusyBillId={statusBusyBillId}
                  onToggleBillStatus={handleToggleBillStatusWithContext}
                />
              )}
            </section>
          )}

          {isAddBillModalOpen ? (
            <>
              <button
                type="button"
                className="sheetBackdrop"
                aria-label="Close add bill form"
                onClick={() => setIsAddBillModalOpen(false)}
              />
              <section className="bottomSheet addBillSheet" role="dialog" aria-modal="true" aria-label="Add bill form">
                <div className="sheetHandle" aria-hidden="true" />
                <div className="sheetHeader">
                  <h3>Add bill</h3>
                  <button
                    type="button"
                    className="sheetToggleBtn"
                    aria-label="Close add bill form"
                    onClick={() => setIsAddBillModalOpen(false)}
                  >
                    ✕
                  </button>
                </div>
                <div className="addBillSheetBody">
                  <AddBillForm
                    billName={billName}
                    billAmount={billAmount}
                    billType={billType}
                    billCategory={billCategory}
                    billDueDate={billDueDate}
                    billDayOfMonth={billDayOfMonth}
                    autopay={autopay}
                    accountLast4={accountLast4}
                    billBusy={billBusy}
                    billError={billError}
                    onSubmit={handleAddBill}
                    onBillNameChange={setBillName}
                    onBillTypeChange={setBillType}
                    onBillCategoryChange={setBillCategory}
                    onBillAmountChange={setBillAmount}
                    onBillDueDateChange={setBillDueDate}
                    onBillDayOfMonthChange={setBillDayOfMonth}
                    onAutopayChange={setAutopay}
                    onAccountLast4Change={setAccountLast4}
                  />
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>
      <form onSubmit={handleSubmit} style={{ width: 360, padding: 24, border: "1px solid #ddd", borderRadius: 12 }}>
        <h1 style={{ marginTop: 0 }}>Family Bill Tracker</h1>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button type="button" onClick={() => setMode("login")} style={{ flex: 1, opacity: mode === "login" ? 1 : 0.6 }}>
            Log in
          </button>
          <button type="button" onClick={() => setMode("signup")} style={{ flex: 1, opacity: mode === "signup" ? 1 : 0.6 }}>
            Sign up
          </button>
        </div>

        <label style={{ display: "block", marginBottom: 8 }}>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={{ width: "100%", padding: 10, marginTop: 6 }} />
        </label>

        <label style={{ display: "block", marginBottom: 8 }}>
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={{ width: "100%", padding: 10, marginTop: 6 }} />
        </label>

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <button disabled={busy} style={{ width: "100%", padding: 12, marginTop: 8 }}>
          {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Log in"}
        </button>
      </form>
    </div>
  );
}
