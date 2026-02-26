import { useEffect, useMemo, useRef, useState } from "react";

type AvatarMenuProps = {
  email: string;
  familyId: string;
  onLogout: () => void;
};

export default function AvatarMenu({ email, familyId, onLogout }: AvatarMenuProps) {
  const [open, setOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
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
