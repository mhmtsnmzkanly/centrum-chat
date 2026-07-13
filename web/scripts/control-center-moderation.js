import { controlCenterStore } from "./control-center-store.js";
import { el, formatBytes, formatDate, renderToast } from "./control-center-common.js";

export function initModerationModule() {
  const filterStatus = document.getElementById("filter-status");
  const filterTarget = document.getElementById("filter-target");
  const filterAssignedMe = document.getElementById("filter-assigned-me");

  const reportsList = document.getElementById("reports-list-container");
  const reportsCount = document.getElementById("reports-count-label");
  const btnLoadMoreReports = document.getElementById("btn-load-more-reports");

  const investigationPlaceholder = document.getElementById(
    "investigation-placeholder",
  );
  const investigationDetails = document.getElementById("investigation-details");
  const sanctionForm = document.getElementById("sanction-form");
  const revokeForm = document.getElementById("revoke-sanction-form");

  sanctionForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userId = document.getElementById("sanction-target-user-id").value;
    const type = document.getElementById("sanction-type").value;
    const reasonCode = document.getElementById("sanction-reason").value;
    const moderatorNote = document.getElementById("sanction-notes").value
      .trim();
    const duration = document.getElementById("sanction-duration").value;
    const expiresAt = duration === "permanent"
      ? null
      : new Date(Date.now() + Number(duration) * 1000).toISOString();
    try {
      await controlCenterStore.applySanction(userId, {
        type,
        reasonCode,
        moderatorNote,
        ...(expiresAt ? { expiresAt } : {}),
      });
      renderToast("success", "Sanction applied.");
      (globalThis.window || globalThis).bootstrap.Modal.getInstance(
        document.getElementById("dialog-apply-sanction"),
      )?.hide();
    } catch (error) {
      renderToast("danger", `Sanction failed: ${error.message}`);
    }
  });

  revokeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const sanctionId = document.getElementById("revoke-sanction-id").value;
    const userId = document.getElementById("revoke-sanction-user-id").value;
    const reason = document.getElementById("revoke-reason-input").value.trim();
    try {
      await controlCenterStore.revokeSanction(sanctionId, userId, reason);
      renderToast("success", "Sanction revoked.");
      (globalThis.window || globalThis).bootstrap.Modal.getInstance(
        document.getElementById("dialog-revoke-sanction"),
      )?.hide();
    } catch (error) {
      if (error.status === 409) {
        await controlCenterStore.loadUserSanctions(userId);
      }
      renderToast("danger", `Revocation failed: ${error.message}`);
    }
  });

  // Filters binding
  function updateFilters() {
    controlCenterStore.update({
      reportsFilters: {
        status: filterStatus.value,
        targetType: filterTarget.value,
        assignedToMe: filterAssignedMe.checked,
      },
    });
    controlCenterStore.loadReports();
  }

  filterStatus?.addEventListener("change", updateFilters);
  filterTarget?.addEventListener("change", updateFilters);
  filterAssignedMe?.addEventListener("change", updateFilters);

  btnLoadMoreReports?.addEventListener("click", () => {
    const state = controlCenterStore.getState();
    if (state.nextReportsCursor) {
      controlCenterStore.loadReports(state.nextReportsCursor, true);
    }
  });

  // Subscribe to store updates
  controlCenterStore.subscribe((state) => {
    const typeSelect = document.getElementById("sanction-type");
    typeSelect?.querySelectorAll("option").forEach((option) => {
      const capability = option.value === "message_mute"
        ? "sanctionsMessageMute"
        : option.value === "interaction_restriction"
        ? "sanctionsInteractionRestriction"
        : "sanctionsAccountSuspension";
      option.disabled = !state.capabilities?.moderation[capability];
    });
    const permanent = document.querySelector(
      '#sanction-duration option[value="permanent"]',
    );
    if (permanent) {
      permanent.disabled = !state.capabilities?.moderation
        .sanctionsAccountSuspension;
    }
    // 1. Render reports list
    if (state.reportsLoading && state.reports.length === 0) {
      reportsList.textContent = "";
      reportsList.appendChild(
        el("div", { className: "text-center my-4 text-muted fs-7" }, [
          el("div", {
            className: "spinner-border spinner-border-sm me-2",
            role: "status",
          }),
          el("span", { textContent: "Loading reports..." }),
        ]),
      );
      btnLoadMoreReports?.classList.add("d-none");
    } else if (state.reportsError) {
      reportsList.textContent = "";
      reportsList.appendChild(
        el("div", { className: "alert alert-danger m-3 fs-7" }, [
          el("span", { textContent: `Error: ${state.reportsError.message}` }),
        ]),
      );
      btnLoadMoreReports?.classList.add("d-none");
    } else if (state.reports.length === 0) {
      reportsList.textContent = "";
      reportsList.appendChild(
        el("div", { className: "text-center my-5 text-muted fs-7" }, [
          el("i", {
            className: "bi bi-check-circle-fill text-success fs-3 d-block mb-2",
          }),
          el("span", { textContent: "All clear! No reports found." }),
        ]),
      );
      btnLoadMoreReports?.classList.add("d-none");
      reportsCount.textContent = "0 reports";
    } else {
      reportsList.textContent = "";
      state.reports.forEach((rep) => {
        const isSelected = rep.id === state.selectedReportId;
        const item = el("div", {
          className: `report-item ${isSelected ? "active" : ""}`,
          role: "button",
          onclick: () => controlCenterStore.loadReportDetails(rep.id),
        }, [
          el("div", {
            className: "d-flex justify-content-between align-items-center mb-1",
          }, [
            el("span", {
              className: "fw-bold fs-7 text-dark-mode-override",
              textContent: rep.id,
            }),
            el("span", {
              className: `report-badge ${rep.status}`,
              textContent: rep.status.replace("_", " "),
            }),
          ]),
          el("div", {
            className: "text-muted fs-8 mb-1",
            textContent:
              `Type: ${rep.targetType.toUpperCase()} | Reason: ${rep.reasonCode}`,
          }),
          el("div", {
            className: "text-dark-mode-override fs-7 text-truncate",
            textContent: rep.details,
          }),
          el("div", {
            className: "text-muted fs-8 text-end mt-1",
            textContent: formatDate(rep.createdAt),
          }),
        ]);
        reportsList.appendChild(item);
      });

      reportsCount.textContent = `${state.reports.length} reports`;
      btnLoadMoreReports?.classList.toggle("d-none", !state.nextReportsCursor);
    }

    // 2. Render selected report investigation details
    if (!state.selectedReportId) {
      investigationPlaceholder?.classList.remove("d-none");
      investigationDetails?.classList.add("d-none");
    } else if (state.selectedReportLoading) {
      investigationPlaceholder?.classList.add("d-none");
      investigationDetails?.classList.remove("d-none");
      investigationDetails.textContent = "";
      investigationDetails.appendChild(
        el("div", { className: "my-auto mx-auto text-center text-muted p-5" }, [
          el("div", {
            className: "spinner-border text-primary mb-3",
            role: "status",
          }),
          el("span", {
            className: "d-block",
            textContent: "Loading report details & context...",
          }),
        ]),
      );
    } else if (state.selectedReportError) {
      investigationPlaceholder?.classList.add("d-none");
      investigationDetails?.classList.remove("d-none");
      investigationDetails.textContent = "";
      investigationDetails.appendChild(
        el("div", { className: "alert alert-danger m-4 my-auto mx-auto" }, [
          el("h5", {
            className: "fw-bold",
            textContent: "Failed to load report",
          }),
          el("p", { textContent: state.selectedReportError.message }),
        ]),
      );
    } else if (state.selectedReportDetails) {
      investigationPlaceholder?.classList.add("d-none");
      investigationDetails?.classList.remove("d-none");
      renderInvestigationPane(investigationDetails, state);
    }
  });
}

function renderInvestigationPane(container, state) {
  container.textContent = "";

  const rep = state.reports.find((r) => r.id === state.selectedReportId) ||
    state.selectedReportDetails;
  const ctx = state.selectedReportContext;
  const targetId = rep.targetType === "user" ? rep.targetId : null;

  // Header workflow row
  const header = el("div", {
    className:
      "p-3 border-bottom d-flex flex-wrap align-items-center justify-content-between gap-2",
  }, [
    el("div", {}, [
      el("h3", {
        className: "h6 fw-bold mb-0 text-dark-mode-override",
        textContent: `Investigation: ${rep.id}`,
      }),
      el("span", {
        className: "text-muted fs-8",
        textContent: `Reported on ${formatDate(rep.createdAt)}`,
      }),
    ]),
    el("div", { className: "d-flex gap-2" }, [
      rep.assignedModeratorId !== state.operator?.id &&
        (!rep.assignedModeratorId || state.operator?.areas?.administration)
        ? el("button", {
          className: "btn btn-sm btn-outline-primary",
          textContent: rep.assignedModeratorId
            ? "Reassign to Me"
            : "Assign to Me",
          onclick: () =>
            controlCenterStore.assignReport(
              rep.id,
              rep.assignedModeratorId,
              state.operator?.id,
            ),
        })
        : null,

      // Status buttons
      rep.status === "open"
        ? el("div", { className: "d-flex gap-2" }, [
          el("button", {
            className: "btn btn-sm btn-primary",
            textContent: "Start Review",
            onclick: () =>
              controlCenterStore.transitionReport(rep.id, "open", "in_review"),
          }),
          el("button", {
            className: "btn btn-sm btn-outline-danger",
            textContent: "Dismiss",
            onclick: () =>
              controlCenterStore.transitionReport(rep.id, "open", "dismissed"),
          }),
        ])
        : null,

      rep.status === "in_review"
        ? el("div", { className: "d-flex gap-2" }, [
          el("button", {
            className: "btn btn-sm btn-outline-secondary",
            textContent: "Return Open",
            onclick: () =>
              controlCenterStore.transitionReport(rep.id, "in_review", "open"),
          }),
          el("button", {
            className: "btn btn-sm btn-success",
            textContent: "Resolve",
            onclick: () =>
              controlCenterStore.transitionReport(
                rep.id,
                "in_review",
                "resolved",
              ),
          }),
          el("button", {
            className: "btn btn-sm btn-outline-danger",
            textContent: "Dismiss",
            onclick: () =>
              controlCenterStore.transitionReport(
                rep.id,
                "in_review",
                "dismissed",
              ),
          }),
        ])
        : null,
    ]),
  ]);

  // Main scrollable details body
  const body = el("div", {
    className: "flex-grow-1 overflow-y-auto p-3 d-flex flex-column gap-3",
  }, [
    // Details card
    el("div", { className: "p-3 border rounded bg-light-subtle" }, [
      el("span", {
        className:
          "fw-bold text-muted text-uppercase tracking-wider fs-8 mb-2 d-block",
        textContent: "Report details",
      }),
      el("div", { className: "fs-7 mb-1 text-dark-mode-override" }, [
        el("strong", { textContent: "Reporter ID: " }),
        el("span", { textContent: rep.reporterUserId }),
      ]),
      el("div", { className: "fs-7 mb-1 text-dark-mode-override" }, [
        el("strong", { textContent: "Reason Code: " }),
        el("span", {
          className: "badge bg-secondary-subtle text-secondary border",
          textContent: rep.reasonCode,
        }),
      ]),
      el("div", { className: "fs-7 mb-2 text-dark-mode-override" }, [
        el("strong", { textContent: "Status: " }),
        el("span", {
          className: `report-badge ${rep.status}`,
          textContent: rep.status,
        }),
      ]),
      el("div", {
        className:
          "p-2 border rounded bg-body fs-7 text-dark-mode-override italic",
        textContent: `"${rep.details}"`,
      }),
    ]),

    // Context visualizer card
    targetId
      ? el(
        "div",
        { className: "p-3 border rounded d-flex flex-column gap-2" },
        [
          el("span", {
            className:
              "fw-bold text-muted text-uppercase tracking-wider fs-8 d-block",
            textContent: "Target context",
          }),
          renderTargetContext(rep, ctx),
        ],
      )
      : null,

    // Contextual Sanctions Card
    el("div", { className: "p-3 border rounded d-flex flex-column gap-2" }, [
      el("div", {
        className: "d-flex align-items-center justify-content-between",
      }, [
        el("span", {
          className: "fw-bold text-muted text-uppercase tracking-wider fs-8",
          textContent: "Target Sanctions History",
        }),
        state.capabilities?.moderation.sanctionsMessageMute ||
          state.capabilities?.moderation.sanctionsInteractionRestriction ||
          state.capabilities?.moderation.sanctionsAccountSuspension
          ? el("button", {
            className: "btn btn-sm btn-danger",
            textContent: "Apply Sanction",
            onclick: () => openSanctionModal(targetId),
          })
          : null,
      ]),
      renderSanctionsList(state),
    ]),
  ]);

  container.appendChild(header);
  container.appendChild(body);
}

function renderTargetContext(rep, ctx) {
  if (!ctx || !ctx.target) {
    return el("div", {
      className: "text-muted fs-7",
      textContent: "Target details unavailable.",
    });
  }

  if (rep.targetType === "message") {
    const messages = (ctx.context || []).length > 0
      ? ctx.context
      : [ctx.target];
    return el(
      "div",
      { className: "chat-context-box p-3 d-flex flex-column" },
      messages.map((message) => {
        const reported = message.id === ctx.target.id;
        return el("div", { className: "mb-2 text-start" }, [
          el("div", {
            className: reported
              ? "text-danger fw-bold fs-8 mb-1"
              : "text-muted fs-8 mb-1",
            textContent: `${reported ? "[REPORTED] " : ""}${
              message.authorId || "deleted user"
            } at ${formatDate(message.createdAt)}`,
          }),
          el("div", {
            className: `chat-bubble-context text-dark-mode-override ${
              reported ? "reported" : ""
            }`,
            textContent: message.deletedAt
              ? "Message deleted."
              : message.content,
          }),
        ]);
      }),
    );
  }

  if (rep.targetType === "user") {
    return el("div", {
      className:
        "d-flex align-items-center gap-3 p-2 bg-light-subtle rounded border",
    }, [
      el("div", {
        className: "avatar-placeholder fs-5",
        textContent: (ctx.target.displayName || ctx.target.username || "U")
          .substring(0, 2).toUpperCase(),
      }),
      el("div", { className: "text-start" }, [
        el("h4", {
          className: "h6 fw-bold mb-0 text-dark-mode-override",
          textContent: ctx.target.displayName || ctx.target.username,
        }),
        el("div", {
          className: "text-muted fs-8",
          textContent: `@${ctx.target.username}`,
        }),
        el("div", {
          className: "fs-7 mt-1 text-dark-mode-override",
          textContent: ctx.target.bio ||
            "No additional profile details returned.",
        }),
      ]),
    ]);
  }

  if (rep.targetType === "attachment") {
    return el("div", {
      className:
        "p-2 border rounded bg-light-subtle d-flex align-items-center gap-3",
    }, [
      el("i", {
        className: "bi bi-file-earmark-arrow-down-fill text-primary fs-2",
      }),
      el("div", { className: "text-start flex-grow-1" }, [
        el("h4", {
          className: "h6 fw-bold mb-0 text-dark-mode-override",
          textContent: ctx.target.fileName,
        }),
        el("div", {
          className: "text-muted fs-8",
          textContent: `Type: ${ctx.target.mimeType} | Size: ${
            formatBytes(ctx.target.sizeBytes)
          }`,
        }),
        ctx.target.uploaderId
          ? el("div", {
            className: "fs-8 text-muted mt-1",
            textContent: `Uploader ID: ${ctx.target.uploaderId}`,
          })
          : null,
      ]),
    ]);
  }

  return el("div", {
    className: "text-muted fs-7",
    textContent: "Unknown target type context.",
  });
}

function renderSanctionsList(state) {
  if (state.userSanctionsLoading) {
    return el("div", { className: "text-center p-2 text-muted fs-8" }, [
      el("div", {
        className: "spinner-border spinner-border-sm me-2",
        role: "status",
      }),
      el("span", { textContent: "Loading sanction history..." }),
    ]);
  }

  if (state.userSanctionsError) {
    return el("div", { className: "alert alert-danger p-2 fs-8 mb-0" }, [
      el("span", { textContent: `Error: ${state.userSanctionsError.message}` }),
    ]);
  }

  if (state.userSanctions.length === 0) {
    return el("div", {
      className: "text-muted p-2 fs-7 text-center border rounded border-dashed",
    }, [
      el("span", { textContent: "No active sanctions found on this account." }),
    ]);
  }

  return el(
    "div",
    { className: "d-flex flex-column gap-2" },
    state.userSanctions.map((s) => {
      const isRevoked = !!s.revokedAt;
      const isExpired = s.expiresAt && new Date(s.expiresAt) < new Date();
      const statusText = isRevoked
        ? "Revoked"
        : (isExpired ? "Expired" : "Active");
      const badgeClass = isRevoked
        ? "bg-secondary"
        : (isExpired ? "bg-secondary" : "bg-danger");

      return el("div", {
        className:
          "p-2 border rounded d-flex justify-content-between align-items-center",
      }, [
        el("div", { className: "text-start fs-7" }, [
          el("div", {}, [
            el("span", {
              className: `badge ${badgeClass} me-2`,
              textContent: s.type.replace("_", " ").toUpperCase(),
            }),
            el("span", {
              className: "text-muted fs-8",
              textContent: `Status: ${statusText}`,
            }),
          ]),
          el("div", {
            className: "text-dark-mode-override mt-1",
            textContent: `Reason: ${s.reasonCode} - Note: ${
              s.moderatorNote || "N/A"
            }`,
          }),
          el("div", {
            className: "text-muted fs-8",
            textContent: `Expires: ${
              s.expiresAt ? formatDate(s.expiresAt) : "Permanent"
            }`,
          }),
        ]),
        !isRevoked && !isExpired &&
          state.capabilities?.moderation.sanctionsRevoke
          ? el("button", {
            className: "btn btn-sm btn-outline-warning",
            textContent: "Revoke",
            onclick: () => openRevokeModal(s.id, s.userId),
          })
          : null,
      ]);
    }),
  );
}

function openSanctionModal(userId) {
  const modalEl = document.getElementById("dialog-apply-sanction");
  const targetIdInput = document.getElementById("sanction-target-user-id");
  const targetDisplayInput = document.getElementById(
    "sanction-target-user-display",
  );

  if (modalEl && targetIdInput && targetDisplayInput) {
    targetIdInput.value = userId;
    targetDisplayInput.value = userId;

    // reset fields
    document.getElementById("sanction-notes").value = "";

    const bootstrap = (globalThis.window || globalThis).bootstrap;
    if (bootstrap && bootstrap.Modal) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }
}

function openRevokeModal(sanctionId, userId) {
  const modalEl = document.getElementById("dialog-revoke-sanction");
  const sancIdInput = document.getElementById("revoke-sanction-id");
  const userIdInput = document.getElementById("revoke-sanction-user-id");

  if (modalEl && sancIdInput && userIdInput) {
    sancIdInput.value = sanctionId;
    userIdInput.value = userId;
    document.getElementById("revoke-reason-input").value = "";

    const bootstrap = (globalThis.window || globalThis).bootstrap;
    if (bootstrap && bootstrap.Modal) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }
}
