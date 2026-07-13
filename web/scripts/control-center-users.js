import { controlCenterStore } from "./control-center-store.js";
import { el, formatDate, renderToast } from "./control-center-common.js";

export function initUsersModule() {
  const searchInput = document.getElementById("search-users");
  const filterRole = document.getElementById("filter-user-role");

  const usersList = document.getElementById("users-list-container");
  const btnLoadMoreUsers = document.getElementById("btn-load-more-users");

  const userDetailsPlaceholder = document.getElementById(
    "user-details-placeholder",
  );
  const userDetailsContent = document.getElementById("user-details-content");

  // Filter bindings
  let searchTimeout = null;
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      controlCenterStore.update({
        usersFilters: {
          search: searchInput.value,
          role: filterRole.value,
        },
      });
      controlCenterStore.loadUsers();
    }, 300);
  });

  filterRole?.addEventListener("change", () => {
    controlCenterStore.update({
      usersFilters: {
        search: searchInput.value,
        role: filterRole.value,
      },
    });
    controlCenterStore.loadUsers();
  });

  btnLoadMoreUsers?.addEventListener("click", () => {
    const state = controlCenterStore.getState();
    if (state.nextUsersCursor) {
      controlCenterStore.loadUsers(state.nextUsersCursor, true);
    }
  });

  // Subscribe to store updates
  controlCenterStore.subscribe((state) => {
    // 1. Render users list
    if (state.usersLoading && state.users.length === 0) {
      usersList.textContent = "";
      usersList.appendChild(
        el("div", { className: "text-center my-4 text-muted fs-7" }, [
          el("div", {
            className: "spinner-border spinner-border-sm me-2",
            role: "status",
          }),
          el("span", { textContent: "Loading users..." }),
        ]),
      );
      btnLoadMoreUsers?.classList.add("d-none");
    } else if (state.usersError) {
      usersList.textContent = "";
      usersList.appendChild(
        el("div", { className: "alert alert-danger m-3 fs-7" }, [
          el("span", { textContent: state.usersError.message }),
        ]),
      );
      btnLoadMoreUsers?.classList.add("d-none");
    } else if (state.users.length === 0) {
      usersList.textContent = "";
      usersList.appendChild(
        el("div", { className: "text-center my-5 text-muted fs-7" }, [
          el("span", {
            textContent: "No users found matching search filters.",
          }),
        ]),
      );
      btnLoadMoreUsers?.classList.add("d-none");
    } else {
      usersList.textContent = "";
      state.users.forEach((user) => {
        const isSelected = user.id === state.selectedUserId;
        const item = el("div", {
          className: `user-item ${isSelected ? "active" : ""}`,
          role: "button",
          onclick: () => controlCenterStore.loadUserDetails(user.id),
        }, [
          el("div", {
            className: "d-flex justify-content-between align-items-center mb-1",
          }, [
            el("span", {
              className: "fw-bold fs-7 text-dark-mode-override",
              textContent: user.displayName || user.username,
            }),
            el("span", {
              className: "badge bg-secondary-subtle text-secondary border",
              textContent: user.role.toUpperCase(),
            }),
          ]),
          el("div", {
            className: "text-muted fs-8",
            textContent: `@${user.username} | ${user.email || "No email"}`,
          }),
        ]);
        usersList.appendChild(item);
      });

      btnLoadMoreUsers?.classList.toggle("d-none", !state.nextUsersCursor);
    }

    // 2. Render user details workspace
    if (!state.selectedUserId) {
      userDetailsPlaceholder?.classList.remove("d-none");
      userDetailsContent?.classList.add("d-none");
    } else if (state.selectedUserLoading) {
      userDetailsPlaceholder?.classList.add("d-none");
      userDetailsContent?.classList.remove("d-none");
      userDetailsContent.textContent = "";
      userDetailsContent.appendChild(
        el("div", { className: "my-auto mx-auto text-center text-muted p-5" }, [
          el("div", {
            className: "spinner-border text-primary mb-3",
            role: "status",
          }),
          el("span", {
            className: "d-block",
            textContent: "Loading user account details...",
          }),
        ]),
      );
    } else if (state.selectedUserError) {
      userDetailsPlaceholder?.classList.add("d-none");
      userDetailsContent?.classList.remove("d-none");
      userDetailsContent.textContent = "";
      userDetailsContent.appendChild(
        el("div", { className: "alert alert-danger m-4 my-auto mx-auto" }, [
          el("h5", {
            className: "fw-bold",
            textContent: "Failed to load user",
          }),
          el("p", { textContent: state.selectedUserError.message }),
        ]),
      );
    } else if (state.selectedUserDetails) {
      userDetailsPlaceholder?.classList.add("d-none");
      userDetailsContent?.classList.remove("d-none");
      renderUserDetails(userDetailsContent, state);
    }
  });
}

function renderUserDetails(container, state) {
  container.textContent = "";

  const user = state.selectedUserDetails;
  const canEdit = state.capabilities?.administration.usersUpdate;
  const canRevokeSessions = state.capabilities?.administration
    .usersRevokeSessions;
  const canForceReset = state.capabilities?.administration
    .usersForcePasswordReset;
  const canResetMedia = state.capabilities?.administration.usersResetMedia;
  const isTargetOwner = user.role === "owner";

  // Header details card
  const profileCard = el("div", {
    className:
      "p-3 border-bottom d-flex align-items-center gap-3 bg-light-subtle",
  }, [
    el("div", {
      className: "avatar-placeholder fs-4",
      textContent: (user.displayName || user.username || "U").substring(0, 2)
        .toUpperCase(),
    }),
    el("div", { className: "text-start flex-grow-1" }, [
      el("h3", {
        className: "h6 fw-bold mb-0 text-dark-mode-override",
        textContent: user.displayName || user.username,
      }),
      el("span", {
        className: "text-muted fs-8",
        textContent: `@${user.username} | Created ${
          formatDate(user.createdAt)
        }`,
      }),
      el("div", {
        className: "text-muted fs-8 mt-1",
        textContent: `Bio: ${user.bio || "No biography provided."}`,
      }),
    ]),
    el("div", {}, [
      el("span", {
        className: "badge bg-primary",
        textContent: user.role.toUpperCase(),
      }),
    ]),
  ]);

  // Settings & Actions Body
  const body = el("div", {
    className: "flex-grow-1 overflow-y-auto p-3 d-flex flex-column gap-3",
  }, [
    // Information fields
    el("div", { className: "p-3 border rounded" }, [
      el("span", {
        className:
          "fw-bold text-muted text-uppercase tracking-wider fs-8 mb-2 d-block",
        textContent: "System Account Status",
      }),
      el("div", { className: "fs-7 mb-1 text-dark-mode-override" }, [
        el("strong", { textContent: "Verification Status: " }),
        el("span", {
          className: `badge ${
            user.emailVerifiedAt
              ? "bg-success-subtle text-success border-success"
              : "bg-warning-subtle text-warning border-warning"
          } border`,
          textContent: user.emailVerifiedAt ? "verified" : "unverified",
        }),
      ]),
      el("div", { className: "fs-7 mb-1 text-dark-mode-override" }, [
        el("strong", { textContent: "Account Status: " }),
        el("span", {
          className: `badge ${
            !user.accountDisabledAt && !user.suspended
              ? "bg-success-subtle text-success"
              : "bg-danger-subtle text-danger"
          }`,
          textContent: user.accountDisabledAt
            ? "disabled"
            : (user.suspended ? "suspended" : "active"),
        }),
      ]),
      el("div", { className: "fs-7 mb-1 text-dark-mode-override" }, [
        el("strong", { textContent: "Password reset required: " }),
        el("span", { textContent: user.mustResetPassword ? "yes" : "no" }),
      ]),
      el("div", { className: "fs-7 text-dark-mode-override" }, [
        el("strong", { textContent: "Email: " }),
        el("span", { textContent: user.email }),
      ]),
    ]),

    canEdit && !isTargetOwner
      ? el("form", {
        className: "p-3 border rounded d-flex flex-column gap-2",
        onsubmit: async (event) => {
          event.preventDefault();
          const displayName = event.currentTarget.elements.displayName.value
            .trim();
          const bio = event.currentTarget.elements.bio.value.trim();
          const disabled = event.currentTarget.elements.disabled.checked;
          const patch = {
            ...(displayName === user.displayName ? {} : { displayName }),
            ...(bio === user.bio ? {} : { bio }),
            ...(disabled === !!user.accountDisabledAt ? {} : { disabled }),
          };
          if (Object.keys(patch).length === 0) return;
          try {
            await controlCenterStore.updateUser(user.id, user.version, patch);
            renderToast("success", "User profile updated.");
          } catch (error) {
            if (error.status === 409) {
              await controlCenterStore.loadUserDetails(user.id);
            }
            renderToast("danger", `Update failed: ${error.message}`);
          }
        },
      }, [
        el("span", {
          className: "fw-bold text-muted text-uppercase tracking-wider fs-8",
          textContent: "Editable account fields",
        }),
        el("input", {
          name: "displayName",
          className: "form-control form-control-sm",
          value: user.displayName,
          maxLength: 50,
        }),
        el("textarea", {
          name: "bio",
          className: "form-control form-control-sm",
          value: user.bio,
          maxLength: 500,
        }),
        el("label", { className: "form-check fs-7" }, [
          el("input", {
            name: "disabled",
            type: "checkbox",
            className: "form-check-input me-2",
            checked: !!user.accountDisabledAt,
          }),
          el("span", { textContent: "Account disabled" }),
        ]),
        el("button", {
          type: "submit",
          className: "btn btn-sm btn-primary",
          textContent: "Save allowed fields",
          disabled: state.pendingActions[`update-user-${user.id}`],
        }),
      ])
      : null,

    // Administrative Actions
    canRevokeSessions || canForceReset || canResetMedia
      ? el("div", {
        className:
          "p-3 border rounded border-warning d-flex flex-column gap-2 bg-warning-subtle",
      }, [
        el("span", {
          className:
            "fw-bold text-warning-emphasis text-uppercase tracking-wider fs-8 mb-1 d-block",
          textContent: "Administrative Controls",
        }),
        el("div", { className: "d-flex flex-wrap gap-2" }, [
          el("button", {
            className: "btn btn-sm btn-outline-warning",
            textContent: "Revoke Active Sessions",
            hidden: !canRevokeSessions,
            disabled: isTargetOwner ||
              state.pendingActions[`revoke-sessions-${user.id}`],
            onclick: () =>
              confirmAction(
                `Revoke every refresh session for @${user.username}? Short-lived stateless access tokens may remain valid until expiry, but runtime account policy still applies.`,
                async () => {
                  await controlCenterStore.revokeUserSessions(user.id);
                  renderToast(
                    "success",
                    `Successfully revoked all sessions for @${user.username}`,
                  );
                },
              ),
          }),
          el("button", {
            className: "btn btn-sm btn-outline-warning",
            textContent: "Force Password Reset",
            hidden: !canForceReset,
            disabled: isTargetOwner ||
              state.pendingActions[`force-pw-reset-${user.id}`],
            onclick: () =>
              confirmAction(
                `Force @${user.username} to complete password recovery? Refresh sessions are revoked and normal mutations remain blocked until reset completion.`,
                async () => {
                  await controlCenterStore.forcePasswordReset(user.id);
                  renderToast(
                    "success",
                    `Successfully queued password reset requirements for @${user.username}`,
                  );
                },
              ),
          }),
          el("button", {
            className: "btn btn-sm btn-outline-danger",
            textContent: "Reset Avatar",
            hidden: !canResetMedia,
            disabled: isTargetOwner ||
              state.pendingActions[`reset-avatar-${user.id}`],
            onclick: () =>
              confirmAction(
                `Remove custom avatar profile image for @${user.username}?`,
                async () => {
                  await controlCenterStore.resetUserAvatar(user.id);
                  renderToast("success", `Avatar reset for @${user.username}`);
                },
              ),
          }),
          el("button", {
            className: "btn btn-sm btn-outline-danger",
            textContent: "Reset Cover Image",
            hidden: !canResetMedia,
            disabled: isTargetOwner ||
              state.pendingActions[`reset-cover-${user.id}`],
            onclick: () =>
              confirmAction(
                `Remove custom profile cover image for @${user.username}?`,
                async () => {
                  await controlCenterStore.resetUserCover(user.id);
                  renderToast(
                    "success",
                    `Cover image reset for @${user.username}`,
                  );
                },
              ),
          }),
        ]),
      ])
      : null,
  ]);

  container.appendChild(profileCard);
  container.appendChild(body);
}

function confirmAction(message, action) {
  const modalEl = document.getElementById("dialog-confirm-action");
  const bodyText = document.getElementById("confirm-action-body");
  const btnConfirm = document.getElementById("btn-confirm-action-submit");

  if (modalEl && bodyText && btnConfirm) {
    bodyText.textContent = message;

    // Remove previous click handlers
    const clonedConfirm = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(clonedConfirm, btnConfirm);

    clonedConfirm.addEventListener("click", async () => {
      const bootstrap = (globalThis.window || globalThis).bootstrap;
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal?.hide();
      try {
        await action();
      } catch (err) {
        renderToast("danger", `Action failed: ${err.message}`);
      }
    });

    const bootstrap = (globalThis.window || globalThis).bootstrap;
    if (bootstrap && bootstrap.Modal) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }
}
