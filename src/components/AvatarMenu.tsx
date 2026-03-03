import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";

type AvatarMenuProps = {
  email: string;
  familyId: string;
  currentUserUid: string;
  onLogout: () => void;
};

type FamilyMember = {
  uid: string;
  email: string;
};

export default function AvatarMenu({ email, familyId, currentUserUid, onLogout }: AvatarMenuProps) {
  const [open, setOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const normalizedEmail = email.trim();
  const normalizedFamilyId = familyId.trim();

  const avatarText = useMemo(() => {
    const firstChar = normalizedEmail.charAt(0);
    return firstChar ? `${firstChar.toUpperCase()}.` : "?";
  }, [normalizedEmail]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!copyNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyNotice(null);
    }, 2500);

    return () => window.clearTimeout(timeoutId);
  }, [copyNotice]);

  useEffect(() => {
    if (!normalizedFamilyId) {
      setFamilyMembers([]);
      setIsLoadingMembers(false);
      setMembersError(null);
      return;
    }

    let active = true;
    let snapshotVersion = 0;
    setIsLoadingMembers(true);
    setMembersError(null);

    const membersRef = collection(db, "families", normalizedFamilyId, "members");
    const unsub = onSnapshot(
      membersRef,
      (membersSnap) => {
        const currentVersion = ++snapshotVersion;
        setIsLoadingMembers(true);
        setMembersError(null);

        void (async () => {
          const memberUids = membersSnap.docs.map((memberDoc) => memberDoc.id);
          console.log("[AvatarMenu] family members snapshot", {
            familyId: normalizedFamilyId,
            memberCount: memberUids.length,
          });

          if (memberUids.length === 0) {
            if (!active || currentVersion !== snapshotVersion) {
              return;
            }

            setFamilyMembers([]);
            setIsLoadingMembers(false);
            return;
          }

          const userSnapshots = await Promise.all(memberUids.map((uid) => getDoc(doc(db, "users", uid))));

          const nextMembers = memberUids.map((uid, index) => {
            const userSnap = userSnapshots[index];
            const userData = userSnap.exists() ? userSnap.data() : null;
            const rawEmail = userData?.email;
            const memberEmail =
              typeof rawEmail === "string" && rawEmail.trim().length > 0 ? rawEmail.trim() : "No email available";

            return {
              uid,
              email: memberEmail,
            };
          });

          nextMembers.sort((a, b) => {
            const aIsCurrent = a.uid === currentUserUid;
            const bIsCurrent = b.uid === currentUserUid;

            if (aIsCurrent && !bIsCurrent) {
              return -1;
            }

            if (!aIsCurrent && bIsCurrent) {
              return 1;
            }

            return a.email.localeCompare(b.email, undefined, { sensitivity: "base" });
          });

          if (!active || currentVersion !== snapshotVersion) {
            return;
          }

          setFamilyMembers(nextMembers);
          setIsLoadingMembers(false);
        })().catch(() => {
          if (!active || currentVersion !== snapshotVersion) {
            return;
          }

          setFamilyMembers([]);
          setIsLoadingMembers(false);
        });
      },
      (error) => {
        if (!active) {
          return;
        }

        console.error("[AvatarMenu] Failed to subscribe to family members", {
          code: error.code,
          details: error.message,
          error,
        });

        setFamilyMembers([]);
        setIsLoadingMembers(false);
        setMembersError("Unable to load family members.");
      },
    );

    return () => {
      active = false;
      unsub();
    };
  }, [currentUserUid, normalizedFamilyId]);

  async function handleCopyFamilyId() {
    if (!normalizedFamilyId) {
      setCopyNotice("No family ID available to copy.");
      return;
    }

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalizedFamilyId);
        setCopyNotice("Family ID copied.");
        return;
      }

      window.prompt("Copy Family ID", normalizedFamilyId);
      setCopyNotice("Clipboard API unavailable. Copied manually.");
    } catch {
      window.prompt("Copy Family ID", normalizedFamilyId);
      setCopyNotice("Clipboard failed. Copied manually.");
    }
  }

  function handleLogoutClick() {
    setOpen(false);
    onLogout();
  }

  return (
    <div className="avatarMenuRoot">
      <button
        ref={triggerRef}
        type="button"
        className="avatarMenuTrigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="account-menu-panel"
      >
        {avatarText}
      </button>

      {open && (
        <>
          <div className="avatarMenuBackdrop" aria-hidden="true" />

          <section
            id="account-menu-panel"
            ref={panelRef}
            className="avatarMenuPanel"
            role="dialog"
            aria-modal="true"
            aria-label="Account menu"
          >
            <div className="avatarMenuHeader">
              <h2 className="avatarMenuTitle">Account</h2>
              <button
                type="button"
                className="avatarMenuCloseBtn"
                onClick={() => setOpen(false)}
                aria-label="Close account menu"
              >
                ×
              </button>
            </div>

            <div className="avatarMenuBody">
              <div className="avatarMenuSection">
                <p>
                  <strong>Signed in as:</strong> {normalizedEmail || "No email available"}
                </p>
              </div>

              <div className="avatarMenuSection">
                <p className="avatarMenuMembersTitle">
                  <strong>Family Members ({familyMembers.length})</strong>
                </p>

                {isLoadingMembers ? (
                  <p className="avatarMenuNotice">Loading family members…</p>
                ) : membersError ? (
                  <p className="avatarMenuNotice">Unable to load family members.</p>
                ) : familyMembers.length === 0 ? (
                  <p className="avatarMenuNotice">No members found.</p>
                ) : (
                  <ul className="avatarMenuMembersList">
                    {familyMembers.map((member) => (
                      <li key={member.uid} className="avatarMenuMembersItem">
                        {member.email}
                        {member.uid === currentUserUid ? " (You)" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="avatarMenuSection">
                <p>
                  <strong>Family ID:</strong> {normalizedFamilyId || "No family linked yet"}
                </p>
                <button
                  type="button"
                  className="avatarMenuCopyBtn"
                  onClick={handleCopyFamilyId}
                  disabled={!normalizedFamilyId}
                >
                  Copy Family ID
                </button>
                {copyNotice && <p className="avatarMenuNotice">{copyNotice}</p>}
              </div>
            </div>

            <div className="avatarMenuFooter">
              <button type="button" className="avatarMenuLogoutBtn" onClick={handleLogoutClick}>
                Log out
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
