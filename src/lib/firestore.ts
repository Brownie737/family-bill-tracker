import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

export type BillStatus = "unpaid" | "paid";

export type BillRecurrence = "monthly" | null;

export type OneTimeBillInput = {
  name: string;
  amount: number;
  dueDate: string;
};

export type RecurringBillInput = {
  name: string;
  amount: number;
  recurrence: "monthly";
  dayOfMonth: number;
};

export type BillInput = OneTimeBillInput | RecurringBillInput;

export type BillListItem = {
  id: string;
  name: string;
  amount: number;
  dueDate?: string | null;
  status: BillStatus;
  recurrence?: BillRecurrence;
  dayOfMonth?: number | null;
  paidForMonth?: string | null;
};

function isRecurringBillInput(bill: BillInput): bill is RecurringBillInput {
  return "recurrence" in bill && bill.recurrence === "monthly";
}

function getCurrentYYYYMM(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function ensureUserDoc(uid: string, email: string | null) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(
      userRef,
      {
        email,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }

  const data = snap.data() as { createdAt?: unknown };
  if (data.createdAt == null) {
    await setDoc(
      userRef,
      {
        email,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }

  await setDoc(
    userRef,
    {
      email,
    },
    { merge: true },
  );
}

export async function createFamilyForUser(uid: string, email: string | null): Promise<string> {
  const familyRef = doc(collection(db, "families"));
  const memberRef = doc(db, "families", familyRef.id, "members", uid);
  const userRef = doc(db, "users", uid);
  const batch = writeBatch(db);

  batch.set(familyRef, {
    createdAt: serverTimestamp(),
  });

  batch.set(memberRef, {
    role: "owner",
    joinedAt: serverTimestamp(),
    email,
  });

  batch.set(
    userRef,
    {
      familyId: familyRef.id,
      email,
    },
    { merge: true },
  );

  await batch.commit();
  return familyRef.id;
}

export async function joinFamily(uid: string, email: string | null, familyId: string) {
  const familyRef = doc(db, "families", familyId);
  const familySnap = await getDoc(familyRef);
  if (!familySnap.exists()) {
    throw new Error("Family not found");
  }

  const memberRef = doc(db, "families", familyId, "members", uid);
  const userRef = doc(db, "users", uid);
  const batch = writeBatch(db);

  batch.set(memberRef, {
    role: "member",
    joinedAt: serverTimestamp(),
    email,
  });

  batch.set(
    userRef,
    {
      familyId,
      email,
    },
    { merge: true },
  );

  await batch.commit();
  return familyId;
}

export function listenToUserFamilyId(uid: string, onChange: (familyId: string | null) => void) {
  const userRef = doc(db, "users", uid);
  return onSnapshot(userRef, (snap) => {
    if (!snap.exists()) {
      onChange(null);
      return;
    }

    const data = snap.data();
    const nextFamilyId = data?.familyId;
    onChange(typeof nextFamilyId === "string" || nextFamilyId === null ? nextFamilyId : null);
  });
}

export async function addBill(familyId: string, uid: string, bill: BillInput) {
  const billsRef = collection(db, "families", familyId, "bills");
  const commonFields = {
    name: bill.name,
    amount: bill.amount,
    createdAt: serverTimestamp(),
    createdBy: uid,
  };

  if (isRecurringBillInput(bill)) {
    if (!Number.isInteger(bill.dayOfMonth) || bill.dayOfMonth < 1 || bill.dayOfMonth > 31) {
      throw new Error("dayOfMonth must be an integer between 1 and 31");
    }

    await addDoc(billsRef, {
      ...commonFields,
      recurrence: "monthly",
      dayOfMonth: bill.dayOfMonth,
      paidForMonth: null,
      dueDate: null,
      status: "unpaid",
    });
    return;
  }

  await addDoc(billsRef, {
    ...commonFields,
    dueDate: bill.dueDate.trim() || null,
    status: "unpaid",
  });
}

export async function toggleBillStatus(
  familyId: string,
  billId: string,
  nextStatus: "paid" | "unpaid",
  options?: { recurrence?: BillRecurrence; currentYYYYMM?: string | null },
) {
  const billRef = doc(db, "families", familyId, "bills", billId);

  let recurrence: BillRecurrence = options?.recurrence === "monthly" ? "monthly" : null;

  if (recurrence == null) {
    const billSnap = await getDoc(billRef);
    if (billSnap.exists()) {
      const billData = billSnap.data();
      recurrence = billData?.recurrence === "monthly" ? "monthly" : null;
    }
  }

  if (recurrence === "monthly") {
    const currentYYYYMM = options?.currentYYYYMM?.trim() || getCurrentYYYYMM();
    await updateDoc(billRef, {
      paidForMonth: nextStatus === "paid" ? currentYYYYMM : null,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await updateDoc(billRef, {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });
}

export function listenToBills(familyId: string, onChange: (bills: BillListItem[]) => void) {
  const billsRef = collection(db, "families", familyId, "bills");
  const billsQuery = query(billsRef, orderBy("createdAt", "desc"));

  return onSnapshot(billsQuery, (snap) => {
    const bills = snap.docs.map((billDoc) => {
      const data = billDoc.data();
      const rawName = data?.name;
      const rawAmount = data?.amount;
      const rawDueDate = data?.dueDate;
      const rawStatus = data?.status;
      const rawRecurrence = data?.recurrence;
      const rawDayOfMonth = data?.dayOfMonth;
      const rawPaidForMonth = data?.paidForMonth;

      const status: BillStatus = rawStatus === "paid" ? "paid" : "unpaid";
      const recurrence: BillRecurrence = rawRecurrence === "monthly" ? "monthly" : null;
      const dayOfMonth =
        typeof rawDayOfMonth === "number" && Number.isInteger(rawDayOfMonth) && rawDayOfMonth >= 1 && rawDayOfMonth <= 31
          ? rawDayOfMonth
          : null;
      const paidForMonth = typeof rawPaidForMonth === "string" || rawPaidForMonth === null ? rawPaidForMonth : null;

      return {
        id: billDoc.id,
        name: typeof rawName === "string" ? rawName : "",
        amount: typeof rawAmount === "number" ? rawAmount : 0,
        dueDate: typeof rawDueDate === "string" || rawDueDate === null ? rawDueDate : null,
        status,
        recurrence,
        dayOfMonth,
        paidForMonth,
      };
    });

    onChange(bills);
  });
}
