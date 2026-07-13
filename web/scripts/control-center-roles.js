import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function allowedNextRoles(state, target) {
  const caps = state.capabilities;
  const values = [];
  if (target.role === "user") {
    if (caps?.administration.rolesAssignModerator) values.push("moderator");
    if (caps?.owner.adminsAssign) values.push("admin");
  } else if (target.role === "moderator") {
    if (caps?.administration.rolesRevokeModerator) values.push("user");
    if (caps?.owner.adminsAssign) values.push("admin");
  } else if (target.role === "admin" && caps?.owner.adminsRevoke) {
    values.push("user");
  }
  return values;
}

export function initRolesModule() {
  controlCenterStore.subscribe((state) => {
    const userSelect = document.getElementById("role-select-user");
    if (!userSelect) return;
    const selected = userSelect.value;
    userSelect.textContent = "";
    userSelect.appendChild(option("", "Select a user..."));
    for (const user of state.users) {
      if (user.id === state.operator?.id || user.role === "owner") continue;
      if (allowedNextRoles(state, user).length === 0) continue;
      userSelect.appendChild(option(
        user.id,
        `${user.displayName || user.username} (${user.role.toUpperCase()})`,
      ));
    }
    if (state.users.some((user) => user.id === selected)) {
      userSelect.value = selected;
    }
  });
}

export const rolesHandlers = {
  changeRoleUser(e, el) {
    const roleSelect = document.getElementById("role-assign-value");
    const save = document.getElementById("btn-save-role-change");
    if (!roleSelect || !save) return;
    
    const state = controlCenterStore.getState();
    const target = state.users.find((user) => user.id === el.value);
    roleSelect.textContent = "";
    if (!target || target.id === state.operator?.id) {
      roleSelect.appendChild(option("", "No permitted transition"));
      roleSelect.disabled = true;
      save.disabled = true;
      return;
    }
    const roles = allowedNextRoles(state, target);
    roleSelect.appendChild(option("", "Select a transition..."));
    for (const r of roles) {
      roleSelect.appendChild(option(r, r.toUpperCase()));
    }
    roleSelect.disabled = roles.length === 0;
    save.disabled = true;
  },

  changeRoleAssignValue(e, el) {
    const save = document.getElementById("btn-save-role-change");
    if (save) save.disabled = !el.value;
  },

  async clickSaveRoleChange(e, el) {
    const userSelect = document.getElementById("role-select-user");
    const roleSelect = document.getElementById("role-assign-value");
    const save = document.getElementById("btn-save-role-change");
    if (!userSelect || !roleSelect || !save) return;
    
    const state = controlCenterStore.getState();
    const target = state.users.find((user) => user.id === userSelect.value);
    if (!target || !roleSelect.value) return;
    save.disabled = true;
    try {
      await controlCenterStore.updateUserRole(
        target.id,
        target.role,
        roleSelect.value,
      );
      renderToast("success", "User role updated successfully.");
      userSelect.value = "";
      roleSelect.textContent = "";
      roleSelect.appendChild(option("", "No permitted transition"));
      roleSelect.disabled = true;
      save.disabled = true;
    } catch (error) {
      if (error.status === 409) await controlCenterStore.loadUsers();
      renderToast("danger", `Failed to update user role: ${error.message}`);
    }
  }
};
