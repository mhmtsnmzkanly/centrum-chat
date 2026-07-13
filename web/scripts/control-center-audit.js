import { controlCenterStore } from "./control-center-store.js";
import { el, formatDate } from "./control-center-common.js";

export function initAuditModule() {
  // Moderation Audit selectors
  const modActorInput = document.getElementById("mod-audit-actor-id");
  const modTargetInput = document.getElementById("mod-audit-target-id");
  const modClearBtn = document.getElementById("btn-clear-mod-audit-filters");
  const modRows = document.getElementById("mod-audit-log-rows");
  const modPlaceholder = document.getElementById("mod-audit-placeholder");
  const modLoadMoreBtn = document.getElementById("btn-load-more-mod-audit");
  const modCountLabel = document.getElementById("mod-audit-count-label");

  // Security Audit selectors
  const secActorInput = document.getElementById("sec-audit-actor-id");
  const secActionInput = document.getElementById("sec-audit-action-code");
  const secClearBtn = document.getElementById("btn-clear-sec-audit-filters");
  const secRows = document.getElementById("sec-audit-log-rows");
  const secPlaceholder = document.getElementById("sec-audit-placeholder");
  const secLoadMoreBtn = document.getElementById("btn-load-more-sec-audit");
  const secCountLabel = document.getElementById("sec-audit-count-label");

  // Bind filter inputs
  let modTimeout = null;
  function triggerModFilterUpdate() {
    clearTimeout(modTimeout);
    modTimeout = setTimeout(() => {
      controlCenterStore.update({
        auditFilters: {
          actionCode: "",
          actorUserId: modActorInput.value.trim(),
          targetType: "",
          targetId: modTargetInput.value.trim(),
        },
      });
      controlCenterStore.loadAuditEvents();
    }, 300);
  }
  modActorInput?.addEventListener("input", triggerModFilterUpdate);
  modTargetInput?.addEventListener("input", triggerModFilterUpdate);

  modClearBtn?.addEventListener("click", () => {
    modActorInput.value = "";
    modTargetInput.value = "";
    triggerModFilterUpdate();
  });

  let secTimeout = null;
  function triggerSecFilterUpdate() {
    clearTimeout(secTimeout);
    secTimeout = setTimeout(() => {
      controlCenterStore.update({
        auditFilters: {
          actionCode: secActionInput.value.trim(),
          actorUserId: secActorInput.value.trim(),
          targetType: "",
          targetId: "",
        },
      });
      controlCenterStore.loadAuditEvents();
    }, 300);
  }
  secActorInput?.addEventListener("input", triggerSecFilterUpdate);
  secActionInput?.addEventListener("input", triggerSecFilterUpdate);

  secClearBtn?.addEventListener("click", () => {
    secActorInput.value = "";
    secActionInput.value = "";
    triggerSecFilterUpdate();
  });

  // Load more bindings
  modLoadMoreBtn?.addEventListener("click", () => {
    const state = controlCenterStore.getState();
    if (state.nextAuditCursor) {
      controlCenterStore.loadAuditEvents(state.nextAuditCursor, true);
    }
  });
  secLoadMoreBtn?.addEventListener("click", () => {
    const state = controlCenterStore.getState();
    if (state.nextAuditCursor) {
      controlCenterStore.loadAuditEvents(state.nextAuditCursor, true);
    }
  });

  // Subscribe to store updates
  controlCenterStore.subscribe((state) => {
    const {
      currentTab,
      auditEvents,
      auditLoading,
      auditError,
      nextAuditCursor,
    } = state;
    if (currentTab !== "moderation-audit" && currentTab !== "security-audit") {
      return;
    }

    const isModTab = currentTab === "moderation-audit";
    const targetRows = isModTab ? modRows : secRows;
    const targetPlaceholder = isModTab ? modPlaceholder : secPlaceholder;
    const targetLoadMore = isModTab ? modLoadMoreBtn : secLoadMoreBtn;
    const targetCountLabel = isModTab ? modCountLabel : secCountLabel;

    if (!targetRows) return;

    // The one admin-only audit endpoint is presented as focused moderation and broader views.
    let filteredEvents = [...auditEvents];
    const modActionCodes = [
      "report.assign",
      "report.status.transition",
      "sanction.apply",
      "sanction.revoke",
    ];
    if (isModTab) {
      filteredEvents = filteredEvents.filter((e) =>
        modActionCodes.includes(e.actionCode)
      );
    } else {
      filteredEvents = filteredEvents.filter((e) =>
        !modActionCodes.includes(e.actionCode)
      );
    }

    if (auditLoading && filteredEvents.length === 0) {
      targetRows.textContent = "";
      targetPlaceholder?.classList.add("d-none");
      targetRows.appendChild(
        el("tr", {}, [
          el("td", {
            colSpan: 6,
            className: "text-center text-muted py-4 fs-7",
          }, [
            el("div", {
              className: "spinner-border spinner-border-sm me-2",
              role: "status",
            }),
            el("span", { textContent: "Loading audit logs..." }),
          ]),
        ]),
      );
      targetLoadMore?.classList.add("d-none");
      return;
    }

    if (auditError) {
      targetRows.textContent = "";
      targetPlaceholder?.classList.add("d-none");
      targetRows.appendChild(
        el("tr", {}, [
          el("td", {
            colSpan: 6,
            className: "text-center text-danger py-4 fs-7",
          }, [
            el("span", { textContent: `Error: ${auditError.message}` }),
          ]),
        ]),
      );
      targetLoadMore?.classList.add("d-none");
      return;
    }

    if (filteredEvents.length === 0) {
      targetRows.textContent = "";
      targetPlaceholder?.classList.remove("d-none");
      targetLoadMore?.classList.add("d-none");
      targetCountLabel.textContent = "0 events";
      return;
    }

    targetPlaceholder?.classList.add("d-none");
    targetRows.textContent = "";

    filteredEvents.forEach((ev) => {
      const outcomeBadge = el("span", {
        className: `badge ${
          ev.outcome === "success"
            ? "bg-success-subtle text-success border border-success-subtle"
            : "bg-danger-subtle text-danger border border-danger-subtle"
        }`,
        textContent: ev.outcome.toUpperCase(),
      });

      // Metadata JSON formatter
      const metaPre = el("pre", {
        className: "pre-metadata-block m-0 d-none",
        textContent: JSON.stringify(ev.metadata || {}, null, 2),
      });
      const toggleBtn = el("button", {
        className: "btn btn-xs btn-link text-decoration-none p-0 fs-8",
        textContent: "Show Details",
        onclick: () => {
          const isHidden = metaPre.classList.toggle("d-none");
          toggleBtn.textContent = isHidden ? "Show Details" : "Hide Details";
        },
      });

      const row = el("tr", {}, [
        el("td", {
          className: "fs-8 text-muted",
          textContent: formatDate(ev.createdAt),
        }),
        el("td", {
          className: "fw-semibold text-dark-mode-override",
          textContent: ev.actorUserId,
        }),
        el("td", {}, [
          el("span", {
            className: "badge bg-secondary-subtle text-secondary",
            textContent: ev.actionCode,
          }),
        ]),
        el("td", {
          className: "text-muted fs-8",
          textContent: `${ev.targetType || "N/A"}: ${ev.targetId || "N/A"}`,
        }),
        el("td", {}, [outcomeBadge]),
        el("td", {}, [
          el("div", { className: "d-flex flex-column gap-1" }, [
            toggleBtn,
            metaPre,
          ]),
        ]),
      ]);

      targetRows.appendChild(row);
    });

    targetCountLabel.textContent = `${filteredEvents.length} events`;
    targetLoadMore?.classList.toggle("d-none", !nextAuditCursor);
  });
}
