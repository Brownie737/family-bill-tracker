import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { auth } from "./lib/firebase";
import {
  addBill,
  createFamilyForUser,
  ensureUserDoc,
  joinFamily,
  listenToBills,
  listenToUserFamilyId,
  toggleBillStatus,
} from "./lib/firestore";
import type { BillListItem } from "./lib/firestore";
import AvatarMenu from "./components/AvatarMenu";
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
  const [billDueDate, setBillDueDate] = useState("");
  const [billDayOfMonth, setBillDayOfMonth] = useState("1");
  const [billError, setBillError] = useState<string | null>(null);
  const [billBusy, setBillBusy] = useState(false);
  const [bills, setBills] = useState<BillListItem[]>([]);
  const [statusBusyBillId, setStatusBusyBillId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "calendar">("summary");

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
      return;
    }

    const unsub = listenToBills(familyId, (nextBills) => {
      setBills(nextBills);
    });

    return () => unsub();
  }, [familyId]);

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
        });
      } else {
        await addBill(familyId, user.uid, {
          name,
          amount,
          dueDate: billDueDate.trim(),
        });
      }

      setBillName("");
      setBillAmount("");
      setBillDueDate("");
      setBillDayOfMonth("1");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add bill";
      setBillError(message);
    } finally {
      setBillBusy(false);
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

  const isDueThisMonth = (dueDate: string | null | undefined) => {
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return false;
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
      return false;
    }

    return dt.getMonth() === nowMonth && dt.getFullYear() === nowYear;
  };

  const unpaidTotal = sortedBills.reduce(
    (total, bill) => (getDerivedStatus(bill) === "unpaid" ? total + bill.amount : total),
    0,
  );

  const paidTotal = sortedBills.reduce(
    (total, bill) => (getDerivedStatus(bill) === "paid" ? total + bill.amount : total),
    0,
  );

  const dueThisMonthTotal = sortedBills.reduce(
    (total, bill) => {
      if (getDerivedStatus(bill) !== "unpaid") {
        return total;
      }

      if (bill.recurrence === "monthly") {
        return total + bill.amount;
      }

      return isDueThisMonth(bill.dueDate) ? total + bill.amount : total;
    },
    0,
  );

  const overdueTotal = sortedBills.reduce((total, bill) => (isOverdue(bill) ? total + bill.amount : total), 0);

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
            <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
            <h2 style={{ marginTop: 0 }}>Family Setup</h2>

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
                  Summary
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
                  <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
                  <h2 style={{ marginTop: 0 }}>Summary</h2>
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                      <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>Unpaid Total</div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(unpaidTotal)}</div>
                    </div>
                    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                      <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>Paid Total</div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(paidTotal)}</div>
                    </div>
                    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                      <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>Due This Month</div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(dueThisMonthTotal)}</div>
                    </div>
                    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                      <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>Overdue Total</div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(overdueTotal)}</div>
                    </div>
                  </div>
                </div>
 
                  <form onSubmit={handleAddBill} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
                  <h2 style={{ marginTop: 0 }}>Add Bill</h2>

                  <label style={{ display: "block", marginBottom: 8 }}>
                    Name
                    <input
                      value={billName}
                      onChange={(e) => setBillName(e.target.value)}
                      required
                      style={{ width: "100%", padding: 10, marginTop: 6 }}
                    />
                  </label>

                  <label style={{ display: "block", marginBottom: 8 }}>
                    Bill Type
                    <select
                      value={billType}
                      onChange={(e) => setBillType(e.target.value as "one-time" | "monthly")}
                      style={{ width: "100%", padding: 10, marginTop: 6 }}
                    >
                      <option value="one-time">One-Time</option>
                      <option value="monthly">Monthly Recurring</option>
                    </select>
                  </label>

                  <label style={{ display: "block", marginBottom: 8 }}>
                    Amount
                    <input
                      value={billAmount}
                      onChange={(e) => setBillAmount(e.target.value)}
                      type="number"
                      step="0.01"
                      required
                      style={{ width: "100%", padding: 10, marginTop: 6 }}
                    />
                  </label>

                  {billType === "one-time" ? (
                    <label style={{ display: "block", marginBottom: 8 }}>
                      Due Date (optional)
                      <input
                        value={billDueDate}
                        onChange={(e) => setBillDueDate(e.target.value)}
                        type="date"
                        style={{ width: "100%", padding: 10, marginTop: 6 }}
                      />
                    </label>
                  ) : (
                    <label style={{ display: "block", marginBottom: 8 }}>
                      Due Day of Month
                      <select
                        value={billDayOfMonth}
                        onChange={(e) => setBillDayOfMonth(e.target.value)}
                        style={{ width: "100%", padding: 10, marginTop: 6 }}
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

                  {billError && <p style={{ color: "crimson" }}>{billError}</p>}

                  <button disabled={billBusy} style={{ padding: "10px 12px" }}>
                    {billBusy ? "Saving..." : "Add Bill"}
                  </button>
                  </form>

                  <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
                  <h2 style={{ marginTop: 0 }}>Bills</h2>
                  {sortedBills.length === 0 ? (
                    <p style={{ marginBottom: 0 }}>No bills yet.</p>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
                      {sortedBills.map((bill) => (
                        <li key={bill.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                          {(() => {
                            const derivedStatus = getDerivedStatus(bill);
                            const overdue = isOverdue(bill);
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
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <div>
                                  <b>{bill.name}</b>
                                  <div>${bill.amount.toFixed(2)}</div>
                                  <div style={{ fontSize: 13, color: "#555" }}>{dueText}</div>
                                </div>

                                <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
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
                                    onClick={() =>
                                      handleToggleBillStatusWithContext(bill, {
                                        viewedYYYYMM: currentYYYYMM,
                                        currentStatus: derivedStatus,
                                      })
                                    }
                                    disabled={statusBusyBillId === bill.id}
                                    style={{ padding: "8px 10px" }}
                                  >
                                    {statusBusyBillId === bill.id ? "Saving..." : derivedStatus === "paid" ? "Mark Unpaid" : "Mark Paid"}
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        </li>
                      ))}
                    </ul>
                  )}
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
